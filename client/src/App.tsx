import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { UpdatePrompt } from "@/components/pwa/UpdatePrompt";
import LiveEbook from "@/pages/LiveEbook";
import UpcomingSession from "@/pages/UpcomingSession";
import { DebugTools } from "@/components/DebugTools";

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
      <Route component={NotFound} />
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
        {import.meta.env.DEV && <DebugTools channelId="m2w4k" />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
