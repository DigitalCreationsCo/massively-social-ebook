import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Zap, Bug } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DebugToolsProps {
  channelId: string;
}

export function DebugTools({ channelId }: DebugToolsProps) {
  const [loading, setLoading] = useState(false);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('admin_token') || '');

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newToken = e.target.value;
    setAdminToken(newToken);
    localStorage.setItem('admin_token', newToken);
  };

  const { toast } = useToast();
  
  // Only show if debug=true in URL
  const isDebug = new URLSearchParams(window.location.search).get('debug') === 'true';
  
  if (!isDebug) return null;

  const handleForceResolution = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/debug/sessions/resolve', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({ channelId }),
      });
      
      const data = await res.json();
      if (data.success) {
        toast({ title: "Resolution Triggered", description: "The session will end on the next game loop tick." });
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to reach debug endpoint", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-20 right-4 z-[100]">
      <Card className="p-4 bg-black/90 border-primary/50 backdrop-blur-xl shadow-2xl flex flex-col gap-3">
        <div className="flex items-center gap-2 text-primary font-mono text-[10px] uppercase tracking-tighter">
          <Bug className="w-3 h-3" /> Debug Console
        </div>
        <Input 
          type="password" 
          placeholder="Admin Token" 
          value={adminToken} 
          onChange={handleTokenChange}
          className="h-6 text-[10px] font-mono bg-black/50 border-white/10 text-white placeholder:text-white/30"
        />
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleForceResolution}
          disabled={loading}
          className="border-primary/30 hover:bg-primary/20 text-xs font-mono h-8"
        >
          <Zap className="w-3 h-3 mr-2" /> Force Resolution
        </Button>
      </Card>
    </div>
  );
}
