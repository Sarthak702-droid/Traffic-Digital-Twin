import React from "react";
import ReactDOM from "react-dom/client";
import { Providers } from "@/components/providers";
import { Workspace } from "@/components/workspace";
import "@/app/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Providers>
      <Workspace />
    </Providers>
  </React.StrictMode>
);
