import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioNextApp } from "./app-next";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioNextApp />
  </StrictMode>,
);
