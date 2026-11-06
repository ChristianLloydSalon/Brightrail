"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Minus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/feedback";
import { useCurrent } from "@/hooks/use-current";
import { DEFAULT_GRANTS, isBasePermission, PERMISSION_LABELS, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/domain/permissions";
import { CONFIGURABLE_GRANTS, PERMISSIONS, ROLES, type GrantKey } from "@/lib/domain/types";
import { errorMessage, workspaceApi } from "@/lib/services";

export function RolesView() {
  const { workspace, can } = useCurrent();
  const qc = useQueryClient();
  const manage = can("members.manage");
  const grants = { ...DEFAULT_GRANTS, ...workspace?.grants };
  const m = useMutation({ mutationFn: (g: Partial<Record<GrantKey, boolean>>) => workspaceApi.updateGrants(g), onSuccess: async () => { await qc.invalidateQueries(); toast.success("Permissions updated", { description: "Changes apply on each member's next request." }); }, onError: (e) => toast.error(errorMessage(e)) });
  const groups = [...new Set(PERMISSIONS.map((p) => PERMISSION_LABELS[p].group))];
  return (
    <PageContainer wide>
      <PageHeader title="Roles & permissions" description="Built-in roles follow least privilege. A few grants can be toggled per workspace; everything else is fixed so access stays predictable." />
      {!manage && <Alert tone="info" className="mb-5">You can view the permission matrix. Owners and admins can change configurable grants.</Alert>}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {ROLES.map((r) => <div key={r} className="rounded-lg border border-border bg-surface p-3"><p className="font-semibold">{ROLE_LABELS[r]}</p><p className="text-sm text-fg-muted">{ROLE_DESCRIPTIONS[r]}</p></div>)}
      </div>
      <Panel aria-labelledby="matrix-h">
        <PanelHeader id="matrix-h" title="Permission matrix" description="Switches are configurable grants. Lock icons mark fixed permissions." />
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Permission matrix">
          <table className="w-full min-w-[720px] text-left text-base">
            <caption className="sr-only">Permissions by role</caption>
            <thead className="bg-surface-sunken text-sm text-fg-muted">
              <tr><th scope="col" className="px-4 py-2 font-medium">Permission</th>{ROLES.map((r) => <th key={r} scope="col" className="px-3 py-2 text-center font-medium">{ROLE_LABELS[r]}</th>)}</tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g}>
                <tr className="border-t border-border bg-surface-sunken/50"><th scope="rowgroup" colSpan={6} className="px-4 py-1.5 text-xs font-semibold tracking-wide text-fg-subtle uppercase">{g}</th></tr>
                {PERMISSIONS.filter((p) => PERMISSION_LABELS[p].group === g).map((p) => (
                  <tr key={p} className="border-t border-border">
                    <th scope="row" className="px-4 py-2 font-normal">{PERMISSION_LABELS[p].label}<span className="block font-mono text-xs text-fg-subtle">{p}</span></th>
                    {ROLES.map((r) => {
                      const configurable = CONFIGURABLE_GRANTS.find((c) => c.role === r && c.permission === p);
                      const key = `${r}:${p}` as GrantKey;
                      if (configurable) return (
                        <td key={r} className="px-3 py-2 text-center">
                          <Switch checked={grants[key] === true} disabled={!manage || m.isPending} onCheckedChange={(v) => m.mutate({ [key]: v })} aria-label={`${ROLE_LABELS[r]}: ${PERMISSION_LABELS[p].label}`} />
                          <span className="block text-xs text-fg-muted">{grants[key] ? "Granted" : "Not granted"}</span>
                        </td>
                      );
                      const has = isBasePermission(r, p);
                      return (
                        <td key={r} className="px-3 py-2 text-center">
                          <span className="inline-flex items-center gap-1">{has ? <Check className="size-4 text-success" aria-hidden /> : <Minus className="size-4 text-fg-subtle" aria-hidden />}<Lock className="size-3 text-fg-subtle" aria-hidden /></span>
                          <span className="sr-only">{has ? "Allowed" : "Not allowed"}, fixed</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Panel>
    </PageContainer>
  );
}
