import { create } from "zustand";

interface DemoState {
  isDemoMode: boolean;
  setDemoMode: (mode: boolean) => void;
}

export const useDemoStore = create<DemoState>((set) => ({
  isDemoMode: false,
  setDemoMode: (isDemoMode) => set({ isDemoMode }),
}));

/**
 * Detect if the app should run in demo mode.
 * Checks:
 * 1. Vite env variable __DEMO_MODE__ (set via Vite config)
 * 2. URL search param ?demo=true
 */
export function detectDemoMode(): boolean {
  // Vite injects this at build time
  const viteDemo = import.meta.env.VITE_DEMO_MODE === "true";
  if (viteDemo) return true;

  // URL param check
  const params = new URLSearchParams(window.location.search);
  return params.get("demo") === "true";
}
