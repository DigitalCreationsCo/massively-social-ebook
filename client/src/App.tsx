import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdatePrompt } from "@/components/pwa/UpdatePrompt";
import LiveEbook from "@/pages/LiveEbook";
import UpcomingSession from "@/pages/UpcomingSession";
import { VersionOverlay } from "@/components/VersionOverlay";

// Default channel - change here to switch the active channel
// Future: load from database or user preference
export const DEFAULT_CHANNEL_ID = "mystery";

function useAnalyticsHook() {
  const [location] = useLocation();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackEvent("Page View", { path: location });
  }, [location]);
}

function Router() {
  useAnalyticsHook();
  
  return (
    <Switch>
      <Route path="/" component={LiveEbook} />
      <Route path="/upcoming" component={UpcomingSession} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <UpdatePrompt />
        <Router />
        <VersionOverlay />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
