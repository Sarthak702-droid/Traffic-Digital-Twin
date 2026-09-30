import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Workspace } from "./workspace";
import config from "../../../packages/scenario-config/c1-c6.json";
import { useLiveStore } from "@/lib/live";

class Socket {
  static opened = 0;
  onclose = () => {};
  constructor() { Socket.opened++; }
  close() { this.onclose(); }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  Socket.opened = 0;
  useLiveStore.setState({ frame: null, connected: false, received: 0, health: null });
});

function mount(signedIn = false, cachedSignedOut = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cachedSignedOut) client.setQueryData(["session"], null);
  const calls: string[] = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const path = String(input);
    calls.push(path);
    // Bound the broken query-reset loop so a failing regression can finish.
    if (calls.length > 30) return new Promise<Response>(() => {});
    if (path.endsWith("/session/login")) signedIn = true;
    const authorized = signedIn || path.endsWith("/session/login");
    const data = !authorized ? { message: "Sign in required" }
      : path.includes("/session") ? { actor: "alice", role: "operator" }
      : path.endsWith("/network") ? config
      : path.endsWith("/health") ? { timestamp: new Date().toISOString(), components: [] }
      : path.endsWith("/mode") ? { mode: "observe", locks: [] }
      : path.endsWith("/decisions/unresolved") ? { unresolved: [] }
      : [];
    return { ok: authorized, status: authorized ? 200 : 401, json: async () => data, headers: new Headers() } as Response;
  });
  render(<QueryClientProvider client={client}><Workspace /></QueryClientProvider>);
  return { client, calls, expire: () => { signedIn = false; window.dispatchEvent(new Event("session-expired")); } };
}

describe("workspace session boundary", () => {
  it.each([false, true])("keeps the signed-out screen stable without protected requests (cached null=%s)", async (cached) => {
    const { calls } = mount(false, cached);
    await screen.findByLabelText("Username");
    await act(async () => {
      window.dispatchEvent(new Event("session-expired"));
      window.dispatchEvent(new Event("session-expired"));
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    expect(calls).toEqual(["/api/v1/session"]);
    expect(Socket.opened).toBe(0);
    expect(screen.getByText("Signed out")).toBeInTheDocument();
    expect(screen.queryByText(/authenticated role/)).not.toBeInTheDocument();
    expect(screen.queryByText(/EXECUTIVE BRIEFING MODE/)).not.toBeInTheDocument();
    expect(screen.queryByText("Loading network configuration…")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in to load the command center" })).toBeInTheDocument();
  });

  it("loads topology after login and stops reads on expiry while retaining the login form", async () => {
    const { calls, expire } = mount();
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "operator-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByText("Configuration validated");
    expect(screen.getByText("operator · authenticated role")).toBeInTheDocument();
    expect(Socket.opened).toBe(1);
    act(expire);
    await screen.findByLabelText("Username");
    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());
    const atExpiry = calls.length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    expect(calls.length).toBe(atExpiry);
    expect(screen.getByLabelText("Username")).toHaveValue("alice");
    expect(screen.queryByText("Loading network configuration…")).not.toBeInTheDocument();
  });
});
