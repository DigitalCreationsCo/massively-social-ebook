import { createRoot } from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";
import { initAnalytics } from "./lib/analytics";
import "./index.css";
import "web-streams-polyfill/polyfill";

// Initialize analytics BEFORE registering service worker to prevent race condition
// where trackEvent() is called before mixpanel.init() completes
initAnalytics();

createRoot(document.getElementById("root")!).render(<App />);
registerServiceWorker();
