"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/card";
import { usePrefs } from "@/lib/prefs";
import type { DashboardData } from "@/lib/services/types";
import { cn } from "@/lib/utils";

/** First-week checklist in plain language. Hidden once everything is done or the user dismisses it. */
export function GettingStarted({ data, workspaceId }: { data: DashboardData["gettingStarted"]; workspaceId: string }) {
  const dismissed = usePrefs((s) => s.dismissedGettingStarted.includes(workspaceId));
  const dismiss = usePrefs((s) => s.dismissGettingStarted);
  const wf = data.firstWorkflowId ? `/workflows/${data.firstWorkflowId}` : "/workflows";
  const items = [
    { done: data.createdWorkflow, title: "Create a workflow", text: "Start from a template or a blank canvas.", href: "/workflows", cta: "Create" },
    { done: data.connectedIntegration, title: "Connect an app", text: "Add Slack, Discord, Resend email or any HTTPS API so your steps can use it.", href: "/integrations", cta: "Connect" },
    { done: data.published, title: "Publish your workflow", text: "Publishing checks for mistakes and makes the workflow live.", href: `${wf}/edit`, cta: "Open editor" },
    { done: data.ranWorkflow, title: "Run it once", text: "Click Run now on the workflow, or send it a webhook. Then watch each step in Executions.", href: wf, cta: "Run" },
    { done: data.invitedTeammate, title: "Invite a teammate", text: "Share the work. You choose what each person can do.", href: "/settings/members?invite=1", cta: "Invite" },
  ];
  const done = items.filter((i) => i.done).length;
  if (dismissed || done === items.length) return null;
  return (
    <Panel aria-labelledby="gs-h" className="border-primary-border">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="gs-h" className="text-md font-semibold">Getting started</h2>
          <p className="text-sm text-fg-muted">{done} of {items.length} done. Each step takes a minute or two.</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => dismiss(workspaceId)} aria-label="Hide getting started checklist"><X aria-hidden /></Button>
      </div>
      <div className="px-4 pt-3" aria-hidden>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"><div className="h-full rounded-full bg-primary" style={{ width: `${(done / items.length) * 100}%` }} /></div>
      </div>
      <ol className="grid gap-1 p-2 md:grid-cols-2 xl:grid-cols-5">
        {items.map((it, i) => (
          <li key={it.title} className={cn("flex gap-3 rounded-md p-2.5", !it.done && "bg-surface-sunken/60")}>
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", it.done ? "border-success-border bg-success-soft text-success-fg" : "border-border-strong text-fg-muted")} aria-hidden>
              {it.done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className={cn("font-medium", it.done && "text-fg-muted line-through")}>{it.title}<span className="sr-only">{it.done ? " (done)" : " (to do)"}</span></span>
              {!it.done && <span className="text-sm text-fg-muted">{it.text}</span>}
              {!it.done && <Link href={it.href} className="text-sm font-medium text-link hover:underline">{it.cta}<span className="sr-only">: {it.title}</span></Link>}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
