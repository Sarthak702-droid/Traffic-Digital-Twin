import { create } from "zustand";

export type UserRole = "operator" | "supervisor" | "viewer";
export type TimeHorizon = 0 | 30 | 60 | 120 | 300;
export type NetworkMode = "live" | "comparison";

export interface WorkspaceState {
  selectedNode: string | null;
  selectNode: (id: string | null) => void;
  role: UserRole;
  setRole: (role: UserRole) => void;
  dgpModalOpen: boolean;
  setDgpModalOpen: (open: boolean) => void;
  selectedHorizon: TimeHorizon;
  setSelectedHorizon: (horizon: TimeHorizon) => void;
  networkMode: NetworkMode;
  setNetworkMode: (mode: NetworkMode) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  selectedNode: null,
  selectNode: (id) => set({ selectedNode: id }),
  role: "operator",
  setRole: (role) => set({ role }),
  dgpModalOpen: false,
  setDgpModalOpen: (open) => set({ dgpModalOpen: open }),
  selectedHorizon: 0,
  setSelectedHorizon: (horizon) => set({ selectedHorizon: horizon }),
  networkMode: "live",
  setNetworkMode: (mode) => set({ networkMode: mode }),
}));
