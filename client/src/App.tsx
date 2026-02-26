import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { UpdatePrompt } from "@/components/pwa/UpdatePrompt";
import LiveEbook from "@/pages/LiveEbook";
import UpcomingSession from "@/pages/UpcomingSession";
import { DebugTools } from "@/components/DebugTools";

function Router() {
  return (
    <Switch>
      <Route path="/" component={ LiveEbook } />
      <Route path="/upcoming">
        { () => <UpcomingSession /> }
      </Route>
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
        <DebugTools channelId="m2w4k" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
