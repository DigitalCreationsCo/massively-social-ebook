import { useLiveState } from '@/hooks/use-live-state';
import { CinematicCanvas } from '@/components/CinematicCanvas';
import { DecisionPhase } from '@/components/DecisionPhase';
import { LiveChat } from '@/components/LiveChat';
import { Loader2, WifiOff } from 'lucide-react';

export default function LiveStory() {
  const { 
    isLoading, 
    wsConnected, 
    username, 
    currentBlock, 
    localTimeRemaining, 
    chatHistory, 
    hasVotedCurrent,
    submitChat, 
    submitVote 
  } = useLiveState();

  if (isLoading) {
    return (
      <div className="h-[100dvh] w-full bg-black flex flex-col items-center justify-center text-primary">
        <Loader2 className="w-10 h-10 animate-spin mb-4" />
        <p className="font-serif tracking-widest text-sm uppercase text-white/60">Opening the tome...</p>
      </div>
    );
  }

  return (
    <main className="flex flex-col h-[100dvh] w-full bg-black text-foreground overflow-hidden overscroll-none relative">
      
      {/* Connection Warning Overlay */}
      {!wsConnected && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-destructive/90 text-destructive-foreground text-xs py-1.5 px-4 flex items-center justify-center gap-2 font-medium backdrop-blur-sm shadow-lg">
          <WifiOff className="w-3 h-3" /> Reconnecting to live feed...
        </div>
      )}

      {/* Pane 1: Cinematic Visuals & Narrative (Flex grows to fill available space) */}
      <section className="relative flex-1 min-h-[40vh] overflow-hidden">
        <CinematicCanvas block={currentBlock} />
      </section>

      {/* Pane 2: Decision / Timer Area (Sticky middle) */}
      <section className="z-20 shrink-0 border-t border-white/5 bg-black/80 backdrop-blur-2xl shadow-[0_-20px_40px_rgba(0,0,0,0.8)]">
        <DecisionPhase 
          phase={currentBlock?.phase} 
          timeRemaining={localTimeRemaining} 
          hasVoted={hasVotedCurrent}
          onVote={submitVote} 
        />
      </section>

      {/* Pane 3: Live Chat (Fixed height at bottom) */}
      <section className="relative h-[38vh] min-h-[250px] max-h-[400px] shrink-0 border-t border-white/5 bg-[#050505]">
        <LiveChat 
          history={chatHistory} 
          username={username} 
          onSend={submitChat} 
        />
      </section>

    </main>
  );
}
