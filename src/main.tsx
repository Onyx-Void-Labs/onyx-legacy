import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { SyncProvider } from "./contexts/SyncContext";
import { VaultProvider } from "./contexts/VaultContext";
import { P2PProvider } from "./contexts/P2PContext";

// PREVENT RIGHT CLICK (CONTEXT MENU)
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  // "preventDefault" tells the browser: "I'll handle this. You do nothing."
})

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SyncProvider>
      <P2PProvider>
        <VaultProvider>
          <App />
        </VaultProvider>
      </P2PProvider>
    </SyncProvider>
  </React.StrictMode>
);