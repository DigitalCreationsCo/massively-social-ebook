/**
 * State Manager for Stateful Chronicle RAG
 * 
 * Manages the running summary and notable events chronicle
 * for long-tail story context without token bloat.
 */
import { storage } from "./storage";
import { GoogleGenAI, Type, Schema } from "@google/genai";

const ai = new GoogleGenAI({});

/** Maximum number of notable events to keep in chronicle before compression */
export const CHRONICLE_MAX_LENGTH = 15;

/** Number of oldest events to compress into summary when threshold is reached */
export const CHRONICLE_COMPRESS_BATCH = 10;

/**
 * Gets or creates story state for a session/channel.
 */
export async function getOrCreateStoryState(sessionId: number, channelId: string) {
  let state = await storage.getStoryState(sessionId, channelId);
  
  if (!state) {
    state = await storage.createStoryState({
      sessionId,
      channelId,
      summary: null,
      chronicle: [],
    });
  }
  
  return state;
}

/**
 * Adds a new notable event to the chronicle.
 * Triggers compression if the chronicle exceeds the maximum length.
 */
export async function addNotableEvent(
  sessionId: number,
  channelId: string,
  event: string
): Promise<{ state: Awaited<ReturnType<typeof getOrCreateStoryState>>; compressed: boolean }> {
  const state = await getOrCreateStoryState(sessionId, channelId);
  
  const currentChronicle = (state.chronicle as string[]) || [];
  const newChronicle = [...currentChronicle, event];
  
  let compressed = false;
  let updatedChronicle = newChronicle;
  let updatedSummary = state.summary;
  
  if (newChronicle.length > CHRONICLE_MAX_LENGTH) {
    compressed = true;
    
    const eventsToCompress = newChronicle.slice(0, CHRONICLE_COMPRESS_BATCH);
    const eventsToKeep = newChronicle.slice(CHRONICLE_COMPRESS_BATCH);
    
    const newSummary = await compressEventsToSummary(
      eventsToCompress,
      state.summary
    );
    
    updatedSummary = newSummary 
      ? (state.summary ? `${state.summary} ${newSummary}` : newSummary)
      : state.summary;
    
    updatedChronicle = eventsToKeep;
  }
  
  const updatedState = await storage.updateStoryState(sessionId, channelId, {
    chronicle: updatedChronicle,
    summary: updatedSummary,
  });
  
  return { state: updatedState, compressed };
}

/**
 * Compresses a batch of events into a summary using the LLM.
 */
async function compressEventsToSummary(
  eventsToCompress: string[],
  existingSummary: string | null
): Promise<string | null> {
  if (eventsToCompress.length === 0) return null;
  
  const eventsText = eventsToCompress.join("\n");
  
  const prompt = `
You are a story continuity manager. Compress the following notable events from a story into a brief 3-4 sentence summary that captures the key plot points.

${existingSummary ? `EXISTING SUMMARY:\n${existingSummary}\n` : ""}

NOTABLE EVENTS TO COMPRESS:
${eventsText}

Write a brief summary that captures the essential story developments. Focus on:
- Main characters and their goals
- Key locations or settings established
- Major plot developments or discoveries

Summary (3-4 sentences):
`.trim();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: "text/plain",
      }
    });
    
    return response.text?.trim() || null;
  } catch (err) {
    console.error('[StateManager] Failed to compress events:', err);
    return null;
  }
}

/**
 * Builds the context for story generation, including:
 * - Running summary (compressed older events)
 * - Notable events chronicle (recent major plot points)
 * - Micro-context (last few blocks from positional RAG)
 */
export async function buildStoryContext(
  sessionId: number,
  channelId: string,
  microContext: string
): Promise<{
  context: string;
  chronicle: string[];
  summary: string | null;
}> {
  const state = await getOrCreateStoryState(sessionId, channelId);
  
  const parts: string[] = [];
  
  if (state.summary) {
    parts.push(`SUMMARY (Earlier Events):\n${state.summary}`);
  }
  
  const chronicle = (state.chronicle as string[]) || [];
  if (chronicle.length > 0) {
    parts.push(`NOTABLE EVENTS:`);
    chronicle.forEach(event => {
      parts.push(`- ${event}`);
    });
  }
  
  if (parts.length > 0) {
    parts.push("");
  }
  
  parts.push(microContext);
  
  const context = parts.join("\n");
  
  return {
    context,
    chronicle,
    summary: state.summary,
  };
}

/**
 * Initializes story state for a new session.
 * Call this when a new session starts.
 */
export async function initializeStoryState(sessionId: number, channelId: string) {
  const existing = await storage.getStoryState(sessionId, channelId);
  if (existing) {
    return existing;
  }
  
  return storage.createStoryState({
    sessionId,
    channelId,
    summary: null,
    chronicle: [],
  });
}
