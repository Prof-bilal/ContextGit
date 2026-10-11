import "./theme-bootstrap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../website/app/globals.css";
import "./desktop.css";
import "./shell.css";
import "./shell/avatar/clay.css";

import { installTauriBridge } from "./tauri-bridge";
import App from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

installTauriBridge();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
