import { createRoot } from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";
import "./index.css";
import "web-streams-polyfill/polyfill";

createRoot(document.getElementById("root")!).render(<App />);
registerServiceWorker();
