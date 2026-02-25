import { useState } from 'react';
import { useLiveState } from '@/hooks/use-live-state';
import { Storyblock } from '@/components/Storyblock';
import { DecisionPhase } from '@/components/DecisionPhase';
import { LiveChat } from '@/components/LiveChat';
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
    chatHistory,
    hasVotedCurrent,
    submitChat,
    submitVote,
    voteResults,
    viewerCount,
    mostRecentMessage,
  } = useLiveState(selectedChannel);

  const handleToggleChat = () => {
    setChatOpen((prev) => !prev);
  };

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

      {/* Connection Warning Overlay */ }
      { !wsConnected && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-destructive/90 text-destructive-foreground text-xs py-1.5 px-4 flex items-center justify-center gap-2 font-medium backdrop-blur-sm shadow-lg">
          <WifiOff className="w-3 h-3" /> Reconnecting to live feed...
        </div>
      ) }

      {/* Header bar from v0 */ }
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-end px-5 pt-4 pb-2">
        {/* Channel selector */ }
        {/* <div className="flex items-center gap-2">
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={ () => setShowChannelSelector(!showChannelSelector) }
            className="text-xs font-mono tracking-wider text-foreground border-border bg-background/50 backdrop-blur-sm h-7"
          >
            { CHANNELS.find(c => c.id === selectedChannel)?.name }
          </Button>

          <AnimatePresence>
            { showChannelSelector && (
              <motion.div
                initial={ { opacity: 0, y: -10 } }
                animate={ { opacity: 1, y: 0 } }
                exit={ { opacity: 0, y: -10 } }
                className="absolute top-full left-0 mt-2 bg-background/95 backdrop-blur-md border border-border rounded-lg shadow-lg overflow-hidden z-50"
              >
                { CHANNELS.map((channel) => (
                  <button
                    key={ channel.id }
                    onClick={ () => {
                      setSelectedChannel(channel.id);
                      setShowChannelSelector(false);
                    } }
                    className={ `w-full text-left px-4 py-2 text-sm hover:bg-primary/10 transition-colors ${selectedChannel === channel.id ? 'bg-primary/20 text-primary' : 'text-foreground'
                      }` }
                  >
                    <div className="font-medium">{ channel.name }</div>
                    <div className="text-xs text-muted-foreground">{ channel.description }</div>
                  </button>
                )) }
              </motion.div>
            ) }
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          <Badge variant="outline" className="text-[10px] font-mono tracking-wider text-foreground border-border bg-background/50 backdrop-blur-sm">
            LIVE
          </Badge>
        </div>
      </div> */}

        {/* Live user count from v0 */ }
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="size-3.5" />
          <span className="text-xs font-mono tabular-nums">
            { viewerCount.toLocaleString() }
          </span>
        </div>
      </header>

      {/* Pane 1: Cinematic Visuals & Narrative */ }
      <section className="relative flex-1 min-h-[40vh] overflow-hidden">
        <Storyblock block={ currentBlock } />
      </section>

      {/* Pane 2: Decision / Timer Area */ }
      <section className="z-20 shrink-0 bg-black/80 backdrop-blur-2xl shadow-[0_-20px_40px_rgba(0,0,0,0.8)]">
        <DecisionPhase
          phase={ currentBlock?.phase }
          timeRemaining={ localTimeRemaining }
          hasVoted={ hasVotedCurrent }
          onVote={ submitVote }
          optionA={ currentBlock?.optionA }
          optionB={ currentBlock?.optionB }
          voteResults={ voteResults }
          selectedChoice={ hasVotedCurrent ? (sessionStorage.getItem(`voted_${selectedChannel}_${currentBlock?.id}`) as 'A' | 'B') : null }
        />
      </section>

      {/* Chat panel */ }
      <LiveChat
        history={ chatHistory }
        mostRecentMessage={ mostRecentMessage }
        username={ username }
        onSend={ submitChat }
        isOpen={ chatOpen }
        onToggle={ handleToggleChat }
      />

    </main >
  );
}
