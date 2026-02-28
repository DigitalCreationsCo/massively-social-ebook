import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Zap, Bug, Play, Square, FastForward, CheckCircle2, ChevronRight, Settings2, Lock, Unlock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

interface DebugToolsProps {
  channelId: string;
}

export function DebugTools({ channelId }: DebugToolsProps) {
  const [ loading, setLoading ] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('admin_token') || '');
  const [ isOpen, setIsOpen ] = useState(false);
  const [ isAuthorized, setIsAuthorized ] = useState(() => {
    const token = localStorage.getItem('admin_token');
    return token === 'dev-token' || (token && token.length > 10); // Simple heuristic for local dev vs prod
  });

  const { toast } = useToast();

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newToken = e.target.value;
    setAdminToken(newToken);
    localStorage.setItem('admin_token', newToken);
    // In a real app, we'd verify this against the server, but for debug tools
    // we just store it and send it with requests.
    setIsAuthorized(newToken.length > 0);
  };

  const callDebugEndpoint = async (endpoint: string, label: string) => {
    setLoading(label);
    try {
      const res = await fetch(`/api/debug/sessions/${endpoint}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({ channelId }),
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        toast({ title: "Success", description: data.message || `${label} triggered.` });
      } else {
        toast({
          title: "Error",
          description: data.message || `Failed to trigger ${label}`,
          variant: "destructive"
        });
      }
    } catch (err) {
      toast({ title: "Error", description: "Network error calling debug endpoint", variant: "destructive" });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-3">
      <AnimatePresence>
        { isOpen && (
          <motion.div
            initial={ { opacity: 0, scale: 0.9, y: 20 } }
            animate={ { opacity: 1, scale: 1, y: 0 } }
            exit={ { opacity: 0, scale: 0.9, y: 20 } }
            className="mb-2"
          >
            <Card className="p-4 w-72 bg-black/95 border-primary/40 backdrop-blur-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] border-t-primary/60 flex flex-col gap-4 overflow-hidden relative">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-primary font-mono text-[10px] uppercase tracking-[0.2em]">
                  <Settings2 className="w-3.5 h-3.5" /> Admin Console
                </div>
                <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest">
                  Channel: { channelId }
                </div>
              </div>

              <div className="space-y-3">
                <div className="relative group">
                  <Input
                    type="password"
                    placeholder="Admin Token"
                    value={ adminToken }
                    onChange={ handleTokenChange }
                    className="h-8 text-[11px] font-mono bg-white/5 border-white/10 text-white placeholder:text-white/20 pl-8 focus-visible:ring-primary/30"
                  />
                  { isAuthorized ? (
                    <Unlock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-primary/60" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/20" />
                  ) }
                </div>

                { !isAuthorized ? (
                  <div className="text-[10px] text-white/40 italic text-center py-4 bg-white/5 rounded-md border border-dashed border-white/10">
                    Enter valid admin token to access controls
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    <div className="text-[9px] font-mono text-primary/60 uppercase tracking-widest mb-1 mt-1">Session</div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={ () => callDebugEndpoint('start', 'Start') }
                        disabled={ !!loading }
                        className="border-primary/20 hover:bg-primary/10 text-[10px] font-mono h-8 justify-start"
                      >
                        <Play className="w-3 h-3 mr-2 text-green-500" /> Start
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={ () => callDebugEndpoint('resolve', 'Resolve') }
                        disabled={ !!loading }
                        className="border-primary/20 hover:bg-primary/10 text-[10px] font-mono h-8 justify-start"
                      >
                        <Square className="w-3 h-3 mr-2 text-red-500" /> End
                      </Button>
                    </div>

                    <div className="text-[9px] font-mono text-primary/60 uppercase tracking-widest mb-1 mt-2">Flow Control</div>
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={ () => callDebugEndpoint('skip', 'Skip Phase') }
                        disabled={ !!loading }
                        className="w-full border-primary/20 hover:bg-primary/10 text-[10px] font-mono h-8 justify-start"
                      >
                        <FastForward className="w-3 h-3 mr-2 text-amber-500" /> Skip Phase
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={ () => callDebugEndpoint('narrative', 'Next Turn') }
                        disabled={ !!loading }
                        className="w-full border-primary/20 hover:bg-primary/10 text-[10px] font-mono h-8 justify-start"
                      >
                        <ChevronRight className="w-3 h-3 mr-2 text-blue-500" /> Next Narrative Turn
                      </Button>
                        <Button
                          variant="outline"
                          size="sm" 
                          onClick={ () => callDebugEndpoint('tally', 'Force Tally') }
                          disabled={ !!loading }
                          className="w-full border-primary/20 hover:bg-primary/10 text-[10px] font-mono h-8 justify-start"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-2 text-emerald-500" /> Force Vote Tally
                        </Button>
                    </div>
                  </div>
                ) }
              </div>

              { loading && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center z-50">
                  <div className="flex flex-col items-center gap-2">
                    <Bug className="w-5 h-5 text-primary animate-pulse" />
                    <span className="text-[9px] font-mono text-primary uppercase tracking-widest">{ loading }...</span>
                  </div>
                </div>
              ) }
            </Card>
          </motion.div>
        ) }
      </AnimatePresence>

      <Button
        onClick={ () => setIsOpen(!isOpen) }
        size="icon"
        className={ `rounded-full w-12 h-12 shadow-2xl transition-all duration-500 border-2 ${isOpen
            ? 'bg-primary text-primary-foreground border-primary/20'
            : 'bg-black/80 text-primary border-primary/40 hover:scale-110'
          }` }
      >
        <Bug className={ `w-6 h-6 transition-transform duration-500 ${isOpen ? 'rotate-180' : ''}` } />
      </Button>
    </div>
  );
}
