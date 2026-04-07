import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { useLocation } from 'wouter';

export default function Install() {
  const [_, setLocation] = useLocation();

  return (
    <main className="flex flex-col h-[100dvh] w-full bg-black text-foreground overflow-auto">
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-start p-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/')}>
          <ArrowLeft className="size-5" />
        </Button>
      </header>

      <div className="container mx-auto max-w-3xl py-20 px-4">
        <h1 className="font-serif text-4xl md:text-5xl text-center text-white/90 tracking-tight leading-tight mb-12">
          Install The App
        </h1>

        <div className="space-y-8">
          <Card className="bg-white/5 border-white/10 text-white/80">
            <CardHeader>
              <CardTitle className="font-mono text-lg tracking-wider">Android (Chrome)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 font-mono text-sm">
              <p>1. Open the app in your Chrome browser.</p>
              <p>2. Tap the three-dot menu in the top-right corner.</p>
              <p>3. Select <span className="font-bold text-white">"Install app"</span> or <span className="font-bold text-white">"Add to Home Screen"</span>.</p>
              <p>4. Follow the on-screen prompts to confirm.</p>
            </CardContent>
          </Card>

          <Card className="bg-white/5 border-white/10 text-white/80">
            <CardHeader>
              <CardTitle className="font-mono text-lg tracking-wider">iOS (Safari)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 font-mono text-sm">
              <p>1. Open the app in your Safari browser.</p>
              <p>2. Tap the "Share" icon at the bottom of the screen.</p>
              <p>3. Scroll down and select <span className="font-bold text-white">"Add to Home Screen"</span>.</p>
              <p>4. Name the app and tap "Add" to finish.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
