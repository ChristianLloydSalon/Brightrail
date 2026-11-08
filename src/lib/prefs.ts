"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Per-browser UI preferences only. All product data lives in Supabase. */
export type ThemePreference = "light" | "dark" | "system";

interface Prefs {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  dismissedGettingStarted: string[];
  setTheme: (t: ThemePreference) => void;
  setSidebarCollapsed: (v: boolean) => void;
  dismissGettingStarted: (workspaceId: string) => void;
}

// One-time carry-over of settings saved before the rename.
try {
  if (typeof window !== "undefined" && !localStorage.getItem("brightrail-prefs")) {
    const old = localStorage.getItem("flowforge-prefs");
    if (old) localStorage.setItem("brightrail-prefs", old);
  }
} catch {
  /* storage unavailable */
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: "system",
      sidebarCollapsed: false,
      dismissedGettingStarted: [],
      setTheme: (theme) => set({ theme }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      dismissGettingStarted: (id) => set((s) => ({ dismissedGettingStarted: [...new Set([...s.dismissedGettingStarted, id])] })),
    }),
    { name: "brightrail-prefs", version: 1 },
  ),
);
