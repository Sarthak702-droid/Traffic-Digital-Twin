import React from "react";
import ReactDOM from "react-dom/client";
import { Providers } from "@/components/providers";
import { Workspace } from "@/components/workspace";
import "@/app/globals.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <main className="context-panel" role="alert">
          <h1>Workspace unavailable</h1>
          <p>
            No successful command outcome is assumed. Retry loading, then inspect
            current state and audit before sending a new command.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry workspace
          </button>
          <a href="/?view=audit">Open audit after recovery</a>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Failed to find root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Providers>
        <Workspace />
      </Providers>
    </ErrorBoundary>
  </React.StrictMode>
);
