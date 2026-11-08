"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reloadTo } from "@/lib/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, History, LogOut, Mail, MousePointerClick, Sparkles, Users, Webhook, Zap } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Logo } from "@/components/layout/logo";
import { useAnnounce } from "@/components/providers/announcer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCurrent } from "@/hooks/use-current";
import { ROLE_LABELS } from "@/lib/domain/permissions";
import type { Role } from "@/lib/domain/types";
import { authApi, errorMessage, membersApi, workflowsApi } from "@/lib/services";
import { TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { EMAIL_RE } from "@/lib/validators";

const STEPS = ["Welcome", "Your workspace", "First workflow", "Your team", "All set"] as const;

function Progress({ step }: { step: number }) {
  return (
    <nav aria-label="Setup progress" className="mb-8">
      <p className="mb-2 text-sm text-fg-muted">Step {step + 1} of {STEPS.length}: <span className="font-medium text-fg">{STEPS[step]}</span></p>
      <ol className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("h-1.5 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-border")} aria-current={i === step ? "step" : undefined}>
            <span className="sr-only">{s}{i < step ? " (done)" : i === step ? " (current)" : ""}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function HowItWorks() {
  const items = [
    { icon: Zap, title: "Something happens", text: "A form is submitted, someone signs up, or you click Run." },
    { icon: MousePointerClick, title: "Brightrail does the steps", text: "Post to Slack, send an email, call an API — in the order you draw." },
    { icon: Eye, title: "You can see every run", text: "If a step fails, it retries safely. The AI assistant explains what went wrong and you decide the fix." },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {items.map((it, i) => (
        <li key={it.title} className="rounded-lg border border-border bg-surface p-4">
          <span className="mb-3 flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg"><it.icon className="size-4" aria-hidden /></span>
          <p className="font-semibold"><span className="sr-only">{i + 1}. </span>{it.title}</p>
          <p className="mt-1 text-sm text-fg-muted">{it.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function OnboardingWizard() {
  const { user, workspaces, invitations, workspace } = useCurrent();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const [step, setStep] = React.useState(0);
  const [wsName, setWsName] = React.useState("");
  const [wsErr, setWsErr] = React.useState<string | null>(null);
  const [templateId, setTemplateId] = React.useState("form-to-slack");
  const [workflowId, setWorkflowId] = React.useState<string | null>(null);
  const [emails, setEmails] = React.useState("");
  const [role, setRole] = React.useState<Role>("editor");
  const [inviteErr, setInviteErr] = React.useState<string | null>(null);
  const [invitedCount, setInvitedCount] = React.useState(0);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const firstName = user?.name?.split(" ")[0] ?? "";

  const go = (n: number) => {
    setStep(n);
    announce(`Step ${n + 1} of ${STEPS.length}: ${STEPS[n]}`);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const accept = useMutation({
    mutationFn: (memberId: string) => authApi.acceptInvitation(memberId),
    onSuccess: async (r) => {
      await authApi.completeOnboarding();
      toast.success(`You joined ${r.workspaceName}`);
      reloadTo("/dashboard");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const createWs = useMutation({
    mutationFn: () => authApi.createWorkspace(wsName, Intl.DateTimeFormat().resolvedOptions().timeZone),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["me"] }); go(2); },
    onError: (e) => setWsErr(errorMessage(e)),
  });
  const createWf = useMutation({
    mutationFn: () => {
      const t = TEMPLATES.find((x) => x.id === templateId)!;
      return workflowsApi.create({ name: t.id === "blank" ? "My first workflow" : t.name, description: t.pitch, triggerType: t.trigger, tags: [], templateId: t.id });
    },
    onSuccess: (wf) => { setWorkflowId(wf.id); go(3); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const invite = useMutation({
    mutationFn: (list: string[]) => membersApi.invite({ emails: list, role }),
    onSuccess: (r) => { setInvitedCount(r.length); go(4); },
    onError: (e) => setInviteErr(errorMessage(e)),
  });
  const finish = async (to: string) => {
    await authApi.completeOnboarding();
    reloadTo(to);
  };
  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const hasWorkspace = !!workspace;

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
        <Logo />
        <Button variant="ghost" size="sm" onClick={async () => { await authApi.signOut(); reloadTo("/sign-in"); }}><LogOut aria-hidden /> Sign out</Button>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <Progress step={step} />

        {step === 0 && (
          <section aria-labelledby="ob-h" className="flex flex-col gap-6">
            <div>
              <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none">Welcome{firstName ? `, ${firstName}` : ""} <span aria-hidden>👋</span></h1>
              <p className="mt-2 text-md text-fg-muted">Brightrail runs your repetitive tasks for you, and tells you clearly when something needs attention. Setup takes about two minutes.</p>
            </div>
            <HowItWorks />
            {invitations.length > 0 && (
              <div className="flex flex-col gap-2">
                <h2 className="text-md font-semibold">You've been invited</h2>
                {invitations.map((inv) => (
                  <div key={inv.memberId} className="flex flex-col gap-3 rounded-lg border border-primary-border bg-primary-soft/40 p-4 sm:flex-row sm:items-center">
                    <Users className="size-5 text-primary" aria-hidden />
                    <p className="flex-1"><strong>{inv.invitedByName}</strong> invited you to <strong>{inv.workspaceName}</strong> as {ROLE_LABELS[inv.role].toLowerCase()}.</p>
                    <Button onClick={() => accept.mutate(inv.memberId)} loading={accept.isPending}>Join {inv.workspaceName}</Button>
                  </div>
                ))}
                <p className="text-sm text-fg-muted">Or set up a workspace of your own below.</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => go(hasWorkspace ? 2 : 1)}>{hasWorkspace ? "Continue setup" : "Set up my workspace"} <ArrowRight aria-hidden /></Button>
              {workspaces.length > 0 && <Button size="lg" variant="ghost" onClick={() => finish("/dashboard")}>Skip to dashboard</Button>}
            </div>
          </section>
        )}

        {step === 1 && (
          <section aria-labelledby="ob-h" className="flex flex-col gap-6">
            <div>
              <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">Name your workspace</h1>
              <p className="mt-1 text-fg-muted">A workspace holds your workflows, connected apps and teammates. Most people use their company or team name.</p>
            </div>
            <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (wsName.trim().length < 2) return setWsErr("Use at least 2 characters."); setWsErr(null); createWs.mutate(); }}>
              <Field label="Workspace name" required error={wsErr} description="You can change this later in settings.">
                {(p) => <Input {...p} value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="e.g. Acme Operations" autoComplete="organization" className="h-11 text-md" />}
              </Field>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => go(0)}><ArrowLeft aria-hidden /> Back</Button>
                <Button type="submit" loading={createWs.isPending} loadingText="Creating…">Create workspace <ArrowRight aria-hidden /></Button>
              </div>
            </form>
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="ob-h" className="flex flex-col gap-6">
            <div>
              <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">Pick a starting point</h1>
              <p className="mt-1 text-fg-muted">Start from a ready-made workflow and adjust it, or start blank. Nothing runs until you publish it.</p>
            </div>
            <fieldset>
              <legend className="sr-only">Starter workflow</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {TEMPLATES.map((t) => {
                  const selected = t.id === templateId;
                  return (
                    <label key={t.id} className={cn("flex cursor-pointer flex-col gap-2 rounded-lg border bg-surface p-4 transition-colors hover:border-border-strong", selected ? "border-primary ring-2 ring-primary/20" : "border-border")}>
                      <span className="flex items-start gap-3">
                        <input type="radio" name="template" value={t.id} checked={selected} onChange={() => setTemplateId(t.id)} className="mt-1 size-4 accent-[var(--primary)]" />
                        <span className="flex flex-col gap-1">
                          <span className="font-semibold">{t.name}</span>
                          <span className="text-sm text-fg-muted">{t.pitch}</span>
                        </span>
                      </span>
                      <span className="ml-7 flex flex-wrap items-center gap-1 text-xs text-fg-muted">
                        {t.trigger === "webhook" ? <Webhook className="size-3.5" aria-hidden /> : <MousePointerClick className="size-3.5" aria-hidden />}
                        {t.steps.join(" → ")}
                      </span>
                      {t.needs.length > 0 && <span className="ml-7"><Badge tone="neutral" className="font-normal">You'll need: {t.needs.join(", ")}</Badge></span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => go(hasWorkspace ? 0 : 1)}><ArrowLeft aria-hidden /> Back</Button>
              <Button onClick={() => createWf.mutate()} loading={createWf.isPending} loadingText="Creating…">Use “{template.id === "blank" ? "Start from scratch" : template.name.split(" ").slice(0, 4).join(" ") + "…"}” <ArrowRight aria-hidden /></Button>
              <Button variant="ghost" onClick={() => go(3)}>Skip for now</Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section aria-labelledby="ob-h" className="flex flex-col gap-6">
            <div>
              <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">Invite your team <span className="text-fg-subtle">(optional)</span></h1>
              <p className="mt-1 text-fg-muted">Teammates get an email with a link to join. You choose what they can do.</p>
            </div>
            <form noValidate className="flex flex-col gap-4" onSubmit={(e) => {
              e.preventDefault();
              const list = emails.split(/[\s,;]+/).filter(Boolean);
              if (!list.length) return go(4);
              const bad = list.filter((x) => !EMAIL_RE.test(x));
              if (bad.length) return setInviteErr(`Not a valid email: ${bad.join(", ")}`);
              setInviteErr(null);
              invite.mutate(list);
            }}>
              <Field label="Email addresses" optional error={inviteErr} description="Separate several addresses with commas.">
                {(p) => <Textarea {...p} rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="sam@company.com, priya@company.com" />}
              </Field>
              <Field label="They can">
                {(p) => <Select<Role> {...p} value={role} onValueChange={setRole} options={[
                  { value: "admin", label: "Manage everything", description: "Admin: workflows, connections, members and settings" },
                  { value: "editor", label: "Build workflows", description: "Editor: create, edit and publish workflows" },
                  { value: "operator", label: "Watch runs and fix failures", description: "Operator: retry, cancel and approve recoveries" },
                  { value: "viewer", label: "Just look", description: "Viewer: read-only access" },
                ]} />}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => go(2)}><ArrowLeft aria-hidden /> Back</Button>
                <Button type="submit" loading={invite.isPending} loadingText="Sending…"><Mail aria-hidden /> {emails.trim() ? "Send invites" : "Continue"}</Button>
                <Button variant="ghost" onClick={() => go(4)}>Skip for now</Button>
              </div>
            </form>
          </section>
        )}

        {step === 4 && (
          <section aria-labelledby="ob-h" className="flex flex-col gap-6">
            <div>
              <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success-fg"><Check className="size-6" aria-hidden /></span>
              <h1 id="ob-h" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">You're all set{firstName ? `, ${firstName}` : ""}!</h1>
              <p className="mt-1 text-fg-muted">{workflowId ? "Your starter workflow is saved as a draft." : "Your workspace is ready."}{invitedCount ? ` We sent ${invitedCount} invitation${invitedCount === 1 ? "" : "s"}.` : ""} Here's what to do next:</p>
            </div>
            <ol className="flex flex-col gap-3">
              {[
                { icon: Zap, title: "Connect the app your workflow uses", text: template.needs.length ? `For this starter: ${template.needs.join(", ")}. Go to Integrations → choose the app → Add connection.` : "Go to Integrations and add the apps you want Brightrail to use." },
                { icon: MousePointerClick, title: "Open the workflow and pick the connection", text: "Steps with something missing are outlined in red with a plain explanation." },
                { icon: Sparkles, title: "Publish, then run it", text: "Publishing makes it live. Click Run now to try it, or create a webhook so other apps can start it." },
                { icon: History, title: "Watch it in Executions", text: "Every step shows what went in and out. If something fails, ask the AI assistant for help." },
              ].map((it, i) => (
                <li key={it.title} className="flex gap-3 rounded-lg border border-border bg-surface p-4">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-soft-fg">{i + 1}</span>
                  <span><span className="font-semibold">{it.title}</span><span className="block text-sm text-fg-muted">{it.text}</span></span>
                </li>
              ))}
            </ol>
            <Alert tone="info">You'll also find a “Getting started” checklist on your dashboard until you've done these.</Alert>
            <div className="flex flex-wrap gap-2">
              {workflowId && <Button size="lg" onClick={() => finish(`/workflows/${workflowId}/edit`)}>Open my workflow <ArrowRight aria-hidden /></Button>}
              <Button size="lg" variant={workflowId ? "outline" : "primary"} onClick={() => finish("/dashboard")}>Go to dashboard</Button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
