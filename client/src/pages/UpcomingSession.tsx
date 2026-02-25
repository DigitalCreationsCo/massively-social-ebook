import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useLiveState } from "@/hooks/use-live-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Bell, Loader2, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { validateSchemaDates } from "@/lib/validateSchema";

export default function UpcomingSession({ channelId = 'x7v9z' }: { channelId?: string; }) {
    const { sessionStatus, activeSession, isLoading } = useLiveState(channelId);
    const { toast } = useToast();
    const [ reminding, setReminding ] = useState(false);
    const [ _, setLocation ] = useLocation();

    const [timeLeft, setTimeLeft] = useState("");

    useEffect(() => {
        if (!activeSession?.scheduledStart) return;

        const target = new Date(activeSession.scheduledStart).getTime();
        
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
    }, [activeSession?.scheduledStart]);

    // Auto-redirect if session becomes active
    useEffect(() => {
        if (sessionStatus === 'active') {
            setLocation('/');
        }
    }, [ sessionStatus, setLocation ]);

    // If session is active, the user should be redirected anyway, but we show a link
    const isScheduled = sessionStatus === 'scheduled' && activeSession;

    const handleReminder = async () => {
        if (!activeSession) return;
        setReminding(true);
        try {
            const res = await fetch(api.sessions.reminder.path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: activeSession.id })
            });

            if (!res.ok) throw new Error("Failed to generate reminder");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `session-${activeSession.id}.ics`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            toast({
                title: "Calendar event downloaded",
                description: "Open the .ics file to add this session to your calendar.",
            });
        } catch (err) {
            toast({
                title: "Error",
                description: "Could not generate calendar reminder.",
                variant: "destructive"
            });
        } finally {
            setReminding(false);
        }
    };


    // Construct schema params and validate before creating the full JSON-LD object
    const schemaParams = activeSession ? {
        startDate: new Date(activeSession.scheduledStart).toISOString(),
        endDate: new Date(activeSession.scheduledEnd).toISOString(),
        validFrom: new Date().toISOString()
    } : null;

    const isValidSchema = schemaParams ? validateSchemaDates(schemaParams) : false;

    const jsonLd = (activeSession && isValidSchema && schemaParams) ? {
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
        <div className="min-h-screen w-full bg-black flex items-center justify-center p-6">
            {jsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
                />
            )}
            <div className="max-w-xl w-full">
                <Card className="bg-white/5 border-white/10 backdrop-blur-xl shadow-2xl overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-primary/50 via-primary to-primary/50" />
                    <CardHeader className="text-center pb-2">
                        <CardTitle className="text-4xl font-serif text-white tracking-tight mb-2">
                            The next story is preparing.
                        </CardTitle>
                        <CardDescription className="text-white/40 font-serif italic text-lg">
                            {activeSession ? (
                                <span className="font-mono tracking-widest text-primary">
                                    Join the global circle in {timeLeft}
                                </span>
                            ) : (
                                "Wait for the alignment of the stars"
                            )}
                        </CardDescription>

                    </CardHeader>

                    <CardContent className="space-y-8 pt-6">
                        { isScheduled ? (
                            <div className="space-y-6">
                                <div className="p-6 bg-white/5 rounded-lg border border-white/10 space-y-4">
                                    <div className="flex items-center gap-4 text-primary">
                                        <Calendar className="w-6 h-6" />
                                        <span className="text-xl font-sans tracking-tight">
                                            { format(new Date(activeSession.scheduledStart), "EEEE, MMMM do 'at' h:mm a") }
                                        </span>
                                    </div>
                                    <h2 className="text-2xl font-serif text-white">{ activeSession.title }</h2>
                                    <p className="text-white/70 font-sans leading-relaxed">{ activeSession.description }</p>
                                </div>

                                <div className="grid grid-cols-1 gap-4 pt-4">
                                    <Button
                                        onClick={ handleReminder }
                                        disabled={ reminding }
                                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-serif text-lg py-8 shadow-[0_0_20px_rgba(var(--primary),0.3)] transition-all hover:shadow-[0_0_30px_rgba(var(--primary),0.5)]"
                                    >
                                        { reminding ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null }
                                        [ Claim My 25 ]
                                    </Button>

                                    <div className="grid grid-cols-2 gap-3">
                                        <Button 
                                            variant="outline" 
                                            className="border-white/10 bg-white/5 hover:bg-white/10 text-white/70 font-sans text-xs uppercase tracking-widest h-auto py-4"
                                            onClick={() => toast({ title: "Coming Soon", description: "Author profiles are being scribed." })}
                                        >
                                            Meet the Author
                                        </Button>
                                        <Button 
                                            variant="outline" 
                                            className="border-white/10 bg-white/5 hover:bg-white/10 text-white/70 font-sans text-xs uppercase tracking-widest h-auto py-4"
                                            onClick={() => toast({ title: "Preview", description: activeSession?.description || "The next chapter awaits." })}
                                        >
                                            Preview Chapter
                                        </Button>
                                    </div>
                                </div>

                            </div>
                        ) : (
                            <div className="py-12 text-center space-y-4 grayscale opacity-50">
                                <Calendar className="w-16 h-16 text-white/20 mx-auto" />
                                <p className="text-white/40 font-serif italic">No sessions currently scheduled.<br />Check back soon.</p>
                            </div>
                        ) }

                        <div className="pt-6 border-t border-white/5 text-center">
                            <p className="text-[10px] text-white/20 uppercase tracking-[0.3em]">
                                The 25th Chapter &bull; Channel { channelId.toUpperCase() }
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
