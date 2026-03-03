import { useState, useEffect } from 'react';
import { trackEvent } from '@/lib/analytics';
import { useLiveState } from '@/hooks/use-live-state';
import { useLocation } from 'wouter';
import { Storyblock } from '@/components/Storyblock';
import { DecisionPhase } from '@/components/DecisionPhase';
import { LiveChat } from '@/components/LiveChat';
import { PushToggle } from "@/components/pwa/PushToggle";
import { Loader2, WifiOff, Users, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

const CHANNELS = [
  { id: 'x7v9z', name: 'Sci-Fi', description: 'Space exploration and alien encounters' },
  { id: 'm2w4k', name: 'Mystery', description: 'Dark alleys and supernatural secrets' }
];

export default function LiveEbook() {
  const [ selectedChannel, setSelectedChannel ] = useState<string>('m2w4k');
  const [ chatOpen, setChatOpen ] = useState(false);
  const [ showChannelSelector, setShowChannelSelector ] = useState(false);

  const {
    isLoading,
    wsConnected,
    username,
    currentBlock,
    localTimeRemaining,
    localTimeToDecision,
    localInitialTimeToDecision,
    localTurnsToNextChoice,
    chatHistory,
    hasVotedCurrent,
    submitChat,
    submitVote,
    voteResults,
    viewerCount,
    mostRecentMessage,
    sessionStatus,
    macroPhase,
    reactions,
    submitReaction
  } = useLiveState(selectedChannel);

  const [ _, setLocation ] = useLocation();

  // Redirect to upcoming if no active session
  if (!isLoading && sessionStatus === 'scheduled') {
    setLocation('/upcoming');
  }

  const handleToggleChat = () => {
    setChatOpen((prev) => !prev);
    trackEvent('Live Chat Toggled', { isOpen: !chatOpen, channel: selectedChannel });
  };

  if (isLoading) {
    return (
      <div className="h-[100dvh] w-full bg-black flex flex-col items-center justify-center text-primary">
        <Loader2 className="w-10 h-10 animate-spin mb-4" />
        <p className="font-serif tracking-widest text-sm text-white/60">Opening...</p>
      </div>
    );
  }

  return (
    <main className="flex flex-col h-[100dvh] w-full bg-black text-foreground overflow-hidden overscroll-none relative">

      {/* Connection Warning Overlay */ }
      { !wsConnected && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-destructive/90 text-destructive-foreground text-xs py-1.5 px-4 flex items-center justify-center gap-2 font-medium backdrop-blur-sm shadow-lg">
          <WifiOff className="w-3 h-3" /> Reconnecting to live feed...
        </div>
      ) }

      {/* Header bar from v0 */ }
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-end px-5 pt-4 pb-2">
        {/* Live user count from v0 */ }
        <div className="flex items-center gap-4">
          <PushToggle />
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="size-3.5" />
            <span className="text-xs font-mono tabular-nums">
              { viewerCount.toLocaleString() }
            </span>
          </div>
        </div>
      </header>

      {/* Pane 1: Cinematic Visuals & Narrative */ }
      <section className="relative flex-1 min-h-[40vh] overflow-hidden">
        {macroPhase === 'gathering' ? (
           <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-black z-10">
             <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               className="space-y-6 max-w-md"
             >
               <h1 className="font-serif text-3xl md:text-4xl text-white/90 tracking-widest uppercase">The Gathering</h1>
               <p className="text-white/60 font-mono text-sm">
                 The session has begun. Readers are arriving from around the world.
                 <br/>
                 The story will start in a few moments.
               </p>
               <div className="h-px w-24 bg-gradient-to-r from-transparent via-white/30 to-transparent mx-auto" />
               <p className="text-xs text-white/40 font-mono animate-pulse">
                 Introduce yourself in the chat below.
               </p>
             </motion.div>
           </div>
        ) : (
           <Storyblock 
             block={ currentBlock } 
             reactions={reactions} 
             onReaction={submitReaction} 
           />
        )}
      </section>

      {/* Pane 2: Decision / Timer Area */}
      <section className="z-20 shrink-0 bg-black/80 backdrop-blur-2xl shadow-[0_-20px_40px_rgba(0,0,0,0.8)]">
        {macroPhase === 'gathering' ? (
           <div className="h-16 flex items-center justify-center border-t border-white/10">
              <span className="font-mono text-xs text-white/50 tracking-widest">AWAITING SIGNAL...</span>
           </div>
        ) : (
          <DecisionPhase
            phase={ currentBlock?.phase }
            timeRemaining={ localTimeRemaining }
            timeToDecision={ localTimeToDecision }
            initialTimeToDecision={ localInitialTimeToDecision }
            turnsToNextChoice={ localTurnsToNextChoice }
            hasVoted={ hasVotedCurrent }
            onVote={ submitVote }
            optionA={ currentBlock?.optionA }
            optionB={ currentBlock?.optionB }
            voteResults={ voteResults }
            selectedChoice={ hasVotedCurrent ? (sessionStorage.getItem(`voted_${selectedChannel}_${currentBlock?.id}`) as 'A' | 'B') : null }
          />
        )}
      </section>

      {/* Chat panel */}
      <LiveChat
        history={ chatHistory }
        mostRecentMessage={ mostRecentMessage }
        username={ username }
        onSend={ submitChat }
        isOpen={ chatOpen || macroPhase === 'gathering' || macroPhase === 'afterparty' }
        onToggle={ handleToggleChat }
      />
    </main >
  );
}
