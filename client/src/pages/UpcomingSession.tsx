import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useLiveState } from "@/hooks/use-live-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Bell, Loader2, BookOpen, Mail } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { validateSchemaDates } from "@/lib/validateSchema";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function UpcomingSession({ channelId = 'm2w4k' }: { channelId?: string; }) {
    const { sessionStatus, activeSession: nextSession, isLoading } = useLiveState(channelId);
    const { toast } = useToast();
    const [ reminding, setReminding ] = useState(false);
    const [ email, setEmail ] = useState("");
    const [ isDialogOpen, setIsDialogOpen ] = useState(false);
    const [ _, setLocation ] = useLocation();

    const [timeLeft, setTimeLeft] = useState("");

    useEffect(() => {
        if (!nextSession?.scheduledStart) return;

        const target = new Date(nextSession.scheduledStart).getTime();
        
        const updateTimer = () => {
            const now = new Date().getTime();
            const diff = target - now;
            
            if (diff <= 0) {
                setTimeLeft("00:00:00");
                return;
            }
            
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            
            setTimeLeft(
                `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
            );
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [ nextSession?.scheduledStart ]);

    // Auto-redirect if session becomes active
    useEffect(() => {
        if (sessionStatus === 'active') {
            setLocation('/');
        }
    }, [ sessionStatus, setLocation ]);

    // If session is active, the user should be redirected anyway, but we show a link
    const isScheduled = sessionStatus === 'scheduled' && nextSession;

    const handleReminder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nextSession || !email) return;
        setReminding(true);
        try {
            const res = await fetch(api.sessions.reminder.path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: nextSession.id,
                    email
                })
            });

            if (!res.ok) throw new Error("Failed to schedule reminder");

            toast({
                title: "Calendar Sync Triggered",
                description: "We've sent a request to add this to your Google and Outlook calendars.",
            });
            setIsDialogOpen(false);
        } catch (err) {
            toast({
                title: "Error",
                description: "Could not schedule calendar reminder.",
                variant: "destructive"
            });
        } finally {
            setReminding(false);
        }
    };


    // Construct schema params and validate before creating the full JSON-LD object
    const schemaParams = nextSession ? {
        startDate: new Date(nextSession.scheduledStart).toISOString(),
        endDate: new Date(nextSession.scheduledEnd).toISOString(),
        validFrom: new Date().toISOString()
    } : null;

    const isValidSchema = schemaParams ? validateSchemaDates(schemaParams) : false;

    const jsonLd = (nextSession && isValidSchema && schemaParams) ? {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "The 25th Chapter: Daily Live Story",
        "description": "A 25-minute synchronous social reading session. Join a global community to read today's featured story together.",
        "image": "https://yourdomain.com/path-to-cinematic-cover.jpg",
        "startDate": schemaParams.startDate,
        "endDate": schemaParams.endDate,
        "eventStatus": "https://schema.org/EventScheduled",
        "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode",
        "location": {
            "@type": "VirtualLocation",
            "url": window.location.origin
        },
        "offers": {
            "@type": "Offer",
            "url": window.location.href,
            "price": "0",
            "priceCurrency": "USD",
            "availability": "https://schema.org/InStock",
            "validFrom": schemaParams.validFrom
        },
        "performer": {
            "@type": "Person",
            "name": "Featured Author"
        },
        "organizer": {
            "@type": "Organization",
            "name": "The 25th Chapter",
            "url": window.location.origin
        }
    } : null;

    if (isLoading || sessionStatus === 'loading') {
        return (
            <div className="h-screen w-full bg-black flex flex-col items-center justify-center text-primary">
                <Loader2 className="w-10 h-10 animate-spin mb-4" />
                <p className="font-serif tracking-widest text-sm text-white/60 uppercase">Checking schedule...</p>
            </div>
        );
    }

    if (sessionStatus === 'active') {
        return (
            <div className="h-screen w-full bg-black flex flex-col items-center justify-center p-6 text-center">
                <div className="max-w-md space-y-6">
                    <BookOpen className="w-16 h-16 text-primary mx-auto animate-pulse" />
                    <h1 className="text-4xl font-serif text-white tracking-tight">Active Now</h1>
                    <p className="text-white/60 font-serif italic">The tome is open and the story is unfolding.</p>
                    <Button
                        onClick={ () => setLocation('/') }
                        className="w-full bg-primary hover:bg-primary/80 text-primary-foreground font-sans uppercase tracking-widest py-6"
                    >
                        Enter the Story
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen w-full bg-black flex flex-col items-center">
            {jsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
                />
            )}

            {/* Hero Section */ }
            <div className="min-h-screen w-full flex items-center justify-center p-6 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-black to-black">
                <div className="max-w-xl w-full">
                    <Card className="bg-white/5 border-white/10 backdrop-blur-xl shadow-2xl overflow-hidden animate-fade-in-up">
                        <div className="h-1 bg-gradient-to-r from-primary/50 via-primary to-primary/50 text-glow-primary" />
                        <CardHeader className="text-center pb-0 pt-12">
                            { isScheduled ? (
                                <>
                                    <CardTitle className="text-3xl font-serif text-white tracking-tight mb-6 leading-tight">
                                        The next story starts soon
                                    </CardTitle>
                                    <CardDescription className="text-white/80 font-sans text-lg">
                                        <>Join {
                                            isToday(new Date(nextSession.scheduledStart)) ? "today" :
                                                isTomorrow(new Date(nextSession.scheduledStart)) ? "tomorrow" :
                                                    format(new Date(nextSession.scheduledStart), "EEEE, MMMM do")
                                        } at <span>{ format(new Date(nextSession.scheduledStart), "h:mm a") }</span></>
                                    </CardDescription>
                                </>
                            ) : (
                                    <CardDescription className="text-white/80 font-sans text-lg">
                                        The next story will be scheduled soon.
                                    </CardDescription>
                            ) }
                        </CardHeader>

                        <CardContent className="space-y-10 pt-8 pb-12 px-8">
                            { isScheduled ? (
                                <div className="space-y-10">
                                    <div className="space-y-4">
                                        <p className="text-xs tracking-[0.4em] text-primary/70 font-sans uppercase text-center">25th Chapter Presents</p>
                                        <div className="p-8 bg-black/40 rounded-xl border border-white/5 space-y-4 shadow-inner">
                                            <h2 className="text-2xl font-serif text-white text-center mb-4 leading-tight">{ nextSession.title }</h2>
                                            <p className="text-white/50 font-sans leading-relaxed text-center group-hover:text-white/70 transition-colors">
                                                A detective descends into a deep mystery. Step into a city where every shadow has a secret.
                                                {/* description: { nextSession.description } */ }
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <Dialog open={ isDialogOpen } onOpenChange={ setIsDialogOpen }>
                                            <DialogTrigger asChild>
                                                <Button
                                                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-serif text-xl py-10 shadow-[0_0_30px_rgba(var(--primary),0.2)] transition-all hover:scale-[1.01]"
                                                >
                                                    Remind me
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent className="bg-zinc-950 border-white/10 text-white shadow-2xl">
                                                <DialogHeader>
                                                    <DialogTitle className="text-3xl font-serif mb-4">Set Reminder</DialogTitle>
                                                    <DialogDescription className="text-white/60 font-serif text-base">
                                                        Enter your email address to receive an invitation before this session starts.
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <form onSubmit={ handleReminder } className="space-y-6 py-6">
                                                    <div className="space-y-3">
                                                        <Label htmlFor="email" className="text-xs tracking-widest text-primary/60 ml-1 hidden">Email Address</Label>
                                                        <Input
                                                            id="email"
                                                            type="email"
                                                            placeholder="youraddress@email.com"
                                                            required
                                                            value={ email }
                                                            onChange={ (e) => setEmail(e.target.value) }
                                                            className="bg-white/5 border-white/10 focus:border-primary/50 h-14 text-lg"
                                                        />
                                                    </div>
                                                    <DialogFooter>
                                                        <Button
                                                            type="submit"
                                                            disabled={ reminding }
                                                            className="w-full h-16 bg-primary text-primary-foreground font-serif text-lg tracking-widest shadow-lg"
                                                        >
                                                            {/* { reminding ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Bell className="w-5 h-5 mr-3" /> } */ }
                                                            Confirm
                                                        </Button>
                                                    </DialogFooter>
                                                </form>
                                            </DialogContent>
                                        </Dialog>

                                        <Button 
                                            variant="ghost"
                                            className="w-full text-white/40 hover:text-white hover:bg-white/5 font-sans text-xs uppercase tracking-[0.3em] py-6 transition-all"
                                            onClick={ () => {
                                                document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth' });
                                            } }
                                        >
                                            Preview chapter
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="py-20 text-center space-y-6 grayscale opacity-30">
                                    <p className="text-white/60 font-sans text-xl">The next story will be scheduled soon.</p>
                                </div>
                            ) }

                            <div className="pt-8 border-t border-white/5 text-center">
                                <p className="text-[10px] text-white/20 uppercase tracking-[0.5em]">
                                    The 25th Chapter
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Preview Section */ }
            <section id="preview" className="flex items-center w-full max-w-6xl px-6 mt-32 space-y-32 min-h-screen">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
                    {/* Mockup Display */ }
                    <div className="lg:col-span-8 space-y-8">
                        <div className="space-y-4">
                            <h2 className="text-4xl font-serif text-white tracking-tight">The 25th Chapter</h2>
                            <p className="text-white/60 font-sans text-lg max-w-2xl leading-relaxed">
                                Join the room, meet readers, experience the story. No scrolling back, no reading ahead. Just you, the community, and the unfolding narrative.
                            </p>
                        </div>
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/40 to-primary/20 rounded-2xl blur-2xl opacity-50 group-hover:opacity-100 transition duration-1000"></div>
                            <div className="relative rounded-xl overflow-hidden border border-white/10 shadow-3xl bg-zinc-900">
                                <img
                                    src="/Users/andresb/.gemini/antigravity/brain/5471c5b2-55e0-4763-9596-12dc57e1e34c/session_mockup_1772142140763.png"
                                    alt="Live Session Mockup"
                                    className="w-full aspect-video object-cover"
                                />
                            </div>
                        </div>
                    </div>

                    {/* FAQ Aside */ }
                    <aside className="lg:col-span-4 space-y-12 bg-white/5 p-10 rounded-2xl border border-white/10 backdrop-blur-sm self-start sticky top-24">
                        <div className="space-y-4">
                            <h2 className="text-3xl font-serif text-white">FAQ</h2>
                            <p className="text-sm text-primary/60 font-sans uppercase tracking-widest">Everything you need to know</p>
                        </div>

                        <div className="space-y-8">
                            <div className="space-y-3">
                                <h3 className="text-lg font-serif text-white">What is a 25-minute session?</h3>
                                <p className="text-white/50 font-sans text-sm leading-relaxed">
                                    Every day is a new chapter. Gather for 25 minutes to read and influence the story in real-time.
                                </p>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-lg font-serif text-white">Can I read missed chapters?</h3>
                                <p className="text-white/50 font-sans text-sm leading-relaxed">
                                    All chapters are saved and will be available soon.
                                    {/* The archives are open to all "Remembrance" holders. Missing a session means missing the live decisions, but not the story. */ }
                                </p>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-lg font-serif text-white">How do decisions work?</h3>
                                <p className="text-white/50 font-sans text-sm leading-relaxed">
                                    Readers decide on key plot points with a community vote. The path with the most support becomes part of the story.
                                </p>
                            </div>
                        </div>

                        <Button
                            className="w-full bg-white/10 hover:bg-white/20 text-white font-serif tracking-widest py-6 border border-white/10"
                            onClick={ () => window.scrollTo({ top: 0, behavior: 'smooth' }) }
                        >
                            Return to top
                        </Button>
                    </aside>
                </div>
            </section>
        </div>
    );
}
