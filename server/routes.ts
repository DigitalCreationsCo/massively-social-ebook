import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { WS_EVENTS, type WsMessage } from "@shared/schema";

// Game State
let currentPhase: 'reading' | 'voting' = 'reading';
let phaseEndsAt: number = Date.now() + 120000; // 2 minutes

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Seed initial block if DB is empty
  let currentBlock = await storage.getCurrentBlock();
  if (!currentBlock) {
    currentBlock = await storage.createBlock({
      content: "The spaceship's hull groaned under the pressure. Alarms blared, bathing the corridor in a harsh, pulsing red light. Commander Vance had a split second to make a decision that would determine the fate of the entire crew.",
      imageUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop"
    });
  }

  // REST API
  app.get(api.blocks.current.path, async (req, res) => {
    const block = await storage.getCurrentBlock();
    if (!block) return res.status(404).json({ message: "No block found" });
    
    res.json({
      ...block,
      createdAt: block.createdAt?.toISOString() ?? new Date().toISOString(),
      phase: currentPhase,
      timeRemaining: Math.max(0, phaseEndsAt - Date.now())
    });
  });

  app.get(api.chat.history.path, async (req, res) => {
    const messages = await storage.getRecentChat(50);
    // Reverse so newest is at the bottom
    res.json(messages.reverse().map(m => ({
      ...m,
      createdAt: m.createdAt?.toISOString() ?? new Date().toISOString()
    })));
  });

  // WebSocket Setup
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcast(message: WsMessage) {
    const payload = JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  wss.on('connection', (ws) => {
    // Send initial state on connect
    if (currentBlock) {
      ws.send(JSON.stringify({
        type: WS_EVENTS.SYNC_STATE,
        payload: {
          ...currentBlock,
          createdAt: currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
          phase: currentPhase,
          timeRemaining: Math.max(0, phaseEndsAt - Date.now())
        }
      }));
    }

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        
        if (message.type === WS_EVENTS.SUBMIT_CHAT) {
          const { username, text } = message.payload as { username: string, text: string };
          console.debug('[Chat.Submit] Context:', { username, textLength: text?.length });
          
          if (username && text) {
            const newMsg = await storage.createChat({ username, text });
            broadcast({
              type: WS_EVENTS.CHAT_MESSAGE,
              payload: {
                ...newMsg,
                createdAt: newMsg.createdAt?.toISOString() ?? new Date().toISOString()
              }
            });
          }
        } else if (message.type === WS_EVENTS.SUBMIT_VOTE) {
          const { choice, userId } = message.payload as { choice: string, userId: string };
          if (currentPhase === 'voting' && currentBlock && (choice === 'A' || choice === 'B')) {
            await storage.createVote({
              blockId: currentBlock.id,
              userId: userId || `anon-${Math.random()}`,
              choice
            });
          }
        }
      } catch (err) {
        console.error("WS message error", err);
      }
    });
  });

  // Game Loop
  setInterval(async () => {
    const now = Date.now();
    if (now >= phaseEndsAt) {
      if (currentPhase === 'reading') {
        currentPhase = 'voting';
        phaseEndsAt = now + 30000; // 30 seconds for voting
      } else {
        // Tally votes and generate next block
        currentPhase = 'reading';
        phaseEndsAt = now + 120000; // 2 minutes for reading
        
        if (currentBlock) {
          const votes = await storage.getVotesForBlock(currentBlock.id);
          const countA = votes.filter(v => v.choice === 'A').length;
          const countB = votes.filter(v => v.choice === 'B').length;
          
          const winner = countA >= countB ? 'A' : 'B';
          
          const nextContent = winner === 'A' 
            ? "Vance slammed his fist onto the manual override. The airlock sealed, trapping the breach but sealing off the engineering bay. The ship shuddered, stabilizing."
            : "Vance routed all power to the shields. The engines died immediately, leaving them adrift, but the hull stopped tearing. The silence that followed was deafening.";
            
          currentBlock = await storage.createBlock({
            content: nextContent,
            imageUrl: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?q=80&w=2072&auto=format&fit=crop"
          });
        }
      }

      if (currentBlock) {
        broadcast({
          type: WS_EVENTS.SYNC_STATE,
          payload: {
            ...currentBlock,
            createdAt: currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
            phase: currentPhase,
            timeRemaining: Math.max(0, phaseEndsAt - Date.now())
          }
        });
      }
    } else {
      // Send time updates every second to keep clients perfectly in sync
      if (currentBlock) {
        broadcast({
          type: WS_EVENTS.SYNC_STATE,
          payload: {
            ...currentBlock,
            createdAt: currentBlock.createdAt?.toISOString() ?? new Date().toISOString(),
            phase: currentPhase,
            timeRemaining: Math.max(0, phaseEndsAt - Date.now())
          }
        });
      }
    }
  }, 1000);

  return httpServer;
}