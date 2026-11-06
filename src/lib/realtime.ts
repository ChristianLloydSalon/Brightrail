"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Live updates via Supabase Realtime (postgres_changes).
 *
 * Change events are only a signal: we never trust or render the payload. Each event invalidates the
 * React Query caches that show that table, and the data is re-read through server actions (which
 * apply permissions). Supabase only delivers events for rows the signed-in member can read (RLS).
 * If Realtime is unavailable, screens keep polling at their normal pace.
 */
export const useLive = create<{ connected: boolean; setConnected: (c: boolean) => void }>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));

/** Poll fast while Realtime is down, slowly (as a safety net) while it's up. */
export function useLiveInterval(fallbackMs: number, liveMs: number) {
  return useLive((s) => (s.connected ? liveMs : fallbackMs));
}

const TABLE_KEYS: Record<string, string[]> = {
  workflow_runs: ["runs", "run", "dashboard", "workflow"],
  workflows: ["workflows", "workflow", "dashboard"],
  approval_requests: ["approvals", "unread", "run", "dashboard"],
  notifications: ["notifications", "unread"],
  webhook_deliveries: ["webhook", "webhooks"],
  connections: ["connections", "connection", "integrations", "integration", "dashboard"],
  workflow_schedules: ["workflow", "integrations", "integration"],
};

export function useRealtimeSync(workspaceId: string | null | undefined) {
  const qc = useQueryClient();
  const setConnected = useLive((s) => s.setConnected);

  React.useEffect(() => {
    if (!workspaceId) return;
    let sb: ReturnType<typeof supabaseBrowser>;
    try {
      sb = supabaseBrowser();
    } catch {
      return; // not configured — polling only
    }
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      for (const key of pending) void qc.invalidateQueries({ queryKey: [key] });
      pending.clear();
    };
    const onChange = (table: string) => {
      for (const k of TABLE_KEYS[table] ?? []) pending.add(k);
      timer ??= setTimeout(flush, 250); // batch bursts (a run writes several times per step)
    };

    let channel = sb.channel(`ws:${workspaceId}`);
    for (const table of Object.keys(TABLE_KEYS)) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` }, () => onChange(table));
    }
    let cancelled = false;
    void sb.auth.getSession().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => {
        const ok = status === "SUBSCRIBED";
        setConnected(ok);
        if (!ok) return;
        // (Re)connected: refresh everything once to catch up on changes missed while offline.
        for (const k of Object.values(TABLE_KEYS).flat()) pending.add(k);
        timer ??= setTimeout(flush, 250);
      });
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setConnected(false);
      void sb.removeChannel(channel);
    };
  }, [workspaceId, qc, setConnected]);
}
