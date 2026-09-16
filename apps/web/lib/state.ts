import { create } from "zustand";
export const useWorkspace = create<{
  selectedNode: string | null;
  selectNode: (id: string | null) => void;
}>((set) => ({
  selectedNode: null,
  selectNode: (id) => set({ selectedNode: id }),
}));
