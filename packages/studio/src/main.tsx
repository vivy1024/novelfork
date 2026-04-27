import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { StudioNextApp, resolveStudioEntryMode } from "./app-next";

const RootApp = resolveStudioEntryMode() === "next" ? StudioNextApp : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
