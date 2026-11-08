"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { can as canFn } from "@/lib/domain/permissions";
import type { Permission } from "@/lib/domain/types";
import { authApi } from "@/lib/services";

/**
 * Current user, workspace and role from the server. Used to tailor the UI; authorization is
 * still enforced in every server action.
 */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => authApi.me(), staleTime: 60_000, retry: false });
}

export function useCurrent() {
  const q = useMe();
  return useMemo(() => {
    const d = q.data;
    const workspace = d?.workspaces.find((w) => w.id === d.activeWorkspaceId) ?? null;
    const role = workspace?.role ?? null;
    return {
      loading: q.isPending,
      error: q.error,
      user: d?.user ?? null,
      workspace,
      role,
      member: workspace ? { role } : null,
      workspaces: d?.workspaces ?? [],
      invitations: d?.invitations ?? [],
      can: (p: Permission) => canFn(role, p, workspace?.grants),
    };
  }, [q.data, q.isPending, q.error]);
}

/** Active workspace id, used to scope React Query cache keys. */
export function useWorkspaceId() {
  return useMe().data?.activeWorkspaceId ?? null;
}
