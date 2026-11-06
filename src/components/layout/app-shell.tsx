"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useOnChange } from "@/hooks/use-on-change";
import { reloadTo } from "@/lib/navigation";
import { Bell, Blocks, Building2, CheckCheck, ChevronsLeft, ChevronsRight, ChevronsUpDown, ClipboardCheck, Gauge, History, KeyRound, LayoutDashboard, LogOut, Menu, Monitor, Moon, Plus, ScrollText, Settings, Shield, Sun, User as UserIcon, Users, Webhook, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SheetContent } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
  Popover, PopoverContent, PopoverTrigger, Tooltip,
} from "@/components/ui/menu";
import { useCurrent, useMe, useWorkspaceId } from "@/hooks/use-current";
import { ROLE_LABELS } from "@/lib/domain/permissions";
import type { Permission } from "@/lib/domain/types";
import { formatRelative } from "@/lib/format";
import { usePrefs, type ThemePreference } from "@/lib/prefs";
import { toast } from "sonner";
import { authApi, notificationsApi } from "@/lib/services";
import { cn } from "@/lib/utils";
import { useLiveInterval, useRealtimeSync } from "@/lib/realtime";
import { Logo } from "./logo";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: Permission;
  badge?: "approvals";
  match?: (p: string) => boolean;
}
const NAV: Array<{ label: string; items: NavItem[] }> = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Build",
    items: [
      { href: "/workflows", label: "Workflows", icon: WorkflowIcon, permission: "workflows.view" },
      { href: "/integrations", label: "Integrations", icon: Blocks, permission: "connections.view", match: (p) => p.startsWith("/integrations") && !p.startsWith("/integrations/webhooks") },
      { href: "/integrations/webhooks", label: "Webhooks", icon: Webhook, permission: "connections.view" },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/executions", label: "Executions", icon: History, permission: "runs.view" },
      { href: "/approvals", label: "Approvals", icon: ClipboardCheck, permission: "runs.view", badge: "approvals" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/settings/workspace", label: "Workspace", icon: Settings },
      { href: "/settings/plan", label: "Plan & usage", icon: Gauge, permission: "workspace.manage" },
      { href: "/settings/members", label: "Members", icon: Users, permission: "members.view" },
      { href: "/settings/roles", label: "Roles & permissions", icon: Shield, permission: "members.view" },
      { href: "/settings/api-keys", label: "API keys", icon: KeyRound, permission: "apikeys.manage" },
      { href: "/settings/audit-log", label: "Audit log", icon: ScrollText, permission: "audit.view" },
    ],
  },
];

/** Unread notification and pending approval counts; pushed by Realtime, polled as a fallback. */
function useUnread() {
  const ws = useWorkspaceId();
  const interval = useLiveInterval(30_000, 300_000);
  const q = useQuery({ queryKey: ["unread", ws], queryFn: () => notificationsApi.unread(), enabled: !!ws, refetchInterval: interval });
  return q.data ?? { notifications: 0, approvals: 0 };
}

/**
 * Pops up new notifications as toasts, honouring the person's in-app preferences. Realtime invalidates
 * ["notifications"], so this refreshes instantly; it also polls slowly as a fallback. History that
 * existed before the page loaded is never toasted.
 */
function useNotificationToasts() {
  const ws = useWorkspaceId();
  const me = useMe().data;
  const { can } = useCurrent();
  const router = useRouter();
  const interval = useLiveInterval(30_000, 300_000);
  const q = useQuery({ queryKey: ["notifications", ws, "toasts"], queryFn: () => notificationsApi.list(), enabled: !!ws, refetchInterval: interval });
  const seen = React.useRef<{ ws: string | null; at: string } | null>(null);
  React.useEffect(() => {
    const items = q.data;
    if (!items) return;
    const newest = items.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");
    if (!seen.current || seen.current.ws !== ws) {
      seen.current = { ws, at: newest || new Date(0).toISOString() };
      return;
    }
    const since = seen.current.at;
    seen.current = { ws, at: newest > since ? newest : since };
    const prefs = me?.user.notificationPrefs;
    for (const n of items.filter((x) => x.createdAt > since && !x.read).reverse()) {
      if (n.kind === "run_failed" && prefs?.runFailures.inApp !== false)
        toast.error(n.title, { description: n.body, action: { label: "View", onClick: () => router.push(n.href) } });
      else if (n.kind === "approval_requested" && prefs?.approvals.inApp !== false && can("approvals.decide"))
        toast(n.title, { description: n.body, action: { label: "Review", onClick: () => router.push(n.href) } });
    }
  }, [q.data, ws, me, can, router]);
}

function usePendingApprovals() {
  return useUnread().approvals;
}

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = useCurrent();
  const pending = usePendingApprovals();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || can(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.label} className="flex flex-col gap-0.5">
            <h2 className={cn("mb-1 px-2 text-xs font-medium tracking-wide text-fg-subtle uppercase", collapsed && "sr-only")}>{group.label}</h2>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = item.match ? item.match(pathname) : pathname === item.href || pathname.startsWith(`${item.href}/`);
                const count = item.badge === "approvals" ? pending : 0;
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    aria-label={collapsed ? `${item.label}${count ? `, ${count} pending` : ""}` : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-2.5 rounded-md px-2 text-base font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg",
                      active && "bg-primary-soft text-primary-soft-fg hover:bg-primary-soft hover:text-primary-soft-fg",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" aria-hidden />}
                    <item.icon className="size-4.5 shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {count > 0 && (
                      <span className={cn("ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-soft px-1.5 text-xs font-semibold text-warning-fg tabular", collapsed && "absolute -top-1 -right-1 ml-0")}>
                        {count}
                        {!collapsed && <span className="sr-only"> pending</span>}
                      </span>
                    )}
                  </Link>
                );
                return <li key={item.href}>{collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}</li>;
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function WorkspaceSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { workspace, workspaces, role, invitations } = useCurrent();
  const qc = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  if (!workspace) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn("flex w-full items-center gap-2.5 rounded-md border border-border bg-surface p-1.5 text-left transition-colors hover:bg-surface-hover", collapsed && "justify-center border-transparent")}
            aria-label={`Workspace: ${workspace.name}. Switch workspace`}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-secondary-soft text-sm font-semibold text-secondary-soft-fg" aria-hidden>
              {workspace.name[0]}
            </span>
            {!collapsed && (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-base font-medium">{workspace.name}</span>
                  <span className="truncate text-xs text-fg-muted">{role ? ROLE_LABELS[role] : ""} · {workspace.plan === "team" ? "Team plan" : "Free plan"}</span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={workspace.id}
            onValueChange={async (id) => {
              try {
                await authApi.setActiveWorkspace(id);
                await qc.invalidateQueries();
                router.push("/dashboard");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {workspaces.map((w) => (
              <DropdownMenuRadioItem key={w.id} value={w.id}>
                <span className="flex flex-col">
                  <span>{w.name}</span>
                  <span className="text-xs text-fg-muted">{ROLE_LABELS[w.role]}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {invitations.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Invitations</DropdownMenuLabel>
              {invitations.map((inv) => (
                <DropdownMenuItem key={inv.memberId} onSelect={() => router.push("/onboarding")}>
                  <span className="flex flex-col"><span>Join {inv.workspaceName}</span><span className="text-xs text-fg-muted">Invited by {inv.invitedByName}</span></span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus aria-hidden /> Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NotificationsMenu() {
  const workspaceId = useWorkspaceId();
  const unread = useUnread().notifications;
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const q = useQuery({ queryKey: ["notifications", workspaceId], queryFn: () => notificationsApi.list(), enabled: open });
  const router = useRouter();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative">
          <Bell aria-hidden />
          {unread > 0 && <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white dark:text-fg-inverse tabular" aria-hidden>{unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-base font-semibold">Notifications</h2>
          <Button variant="ghost" size="sm" disabled={!unread} onClick={async () => { await notificationsApi.markRead("all"); void qc.invalidateQueries({ queryKey: ["unread"] }); void q.refetch(); }}>
            <CheckCheck aria-hidden /> Mark all read
          </Button>
        </div>
        {q.isLoading ? (
          <p className="px-3 py-6 text-center text-sm text-fg-muted" role="status">Loading notifications…</p>
        ) : q.isError ? (
          <p className="px-3 py-6 text-center text-sm text-danger-fg" role="alert">Couldn't load notifications.</p>
        ) : q.data?.length ? (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {q.data.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="flex w-full gap-3 px-3 py-2.5 text-left hover:bg-surface-hover"
                  onClick={() => {
                    void notificationsApi.markRead([n.id]).then(() => qc.invalidateQueries({ queryKey: ["unread"] }));
                    setOpen(false);
                    router.push(n.href);
                  }}
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} aria-hidden />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-base font-medium">{n.title}{!n.read && <span className="sr-only"> (unread)</span>}</span>
                    <span className="text-sm text-fg-muted">{n.body}</span>
                    <span className="text-xs text-fg-subtle">{formatRelative(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-fg-muted">You're all caught up.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { user } = useCurrent();
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const router = useRouter();
  const qc = useQueryClient();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-hover" aria-label={`Account menu for ${user.name}`}>
          <Avatar name={user.name} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2 py-2">
          <p className="truncate text-base font-medium">{user.name}</p>
          <p className="truncate text-sm text-fg-muted">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings/profile")}>
          <UserIcon aria-hidden /> Profile settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/settings/workspace")}>
          <Building2 aria-hidden /> Workspace settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
          <DropdownMenuRadioItem value="light"><Sun className="size-4 text-fg-muted" aria-hidden /> Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark"><Moon className="size-4 text-fg-muted" aria-hidden /> Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system"><Monitor className="size-4 text-fg-muted" aria-hidden /> System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authApi.signOut();
            qc.clear();
            reloadTo("/sign-in");
          }}
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const setTheme = usePrefs((s) => s.setTheme);
  // The <html> class is the source of truth (set by the theme provider), so subscribe to it directly.
  const isDark = React.useSyncExternalStore(
    (cb) => { const o = new MutationObserver(cb); o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => o.disconnect(); },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return (
    <Tooltip content={isDark ? "Switch to light theme" : "Switch to dark theme"}>
      <Button variant="ghost" size="icon" onClick={() => setTheme(isDark ? "light" : "dark")} aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}>
        {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
      </Button>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = usePrefs((s) => s.sidebarCollapsed);
  const setCollapsed = usePrefs((s) => s.setSidebarCollapsed);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();
  useOnChange(pathname, () => setMobileOpen(false));
  useRealtimeSync(useWorkspaceId());
  useNotificationToasts();

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar (≥1024px): full or icon rail */}
      <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex", collapsed ? "w-[68px]" : "w-60")} aria-label="Sidebar">
        <div className={cn("flex h-14 items-center border-b border-border px-4", collapsed && "justify-center px-0")}>
          <Link href="/dashboard" aria-label="FlowForge home" className="rounded-sm">
            <Logo collapsed={collapsed} />
          </Link>
        </div>
        <div className={cn("px-3 pt-3", collapsed && "px-2")}>
          <WorkspaceSwitcher collapsed={collapsed} />
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks collapsed={collapsed} />
        </div>
        <div className={cn("border-t border-border p-3", collapsed && "flex justify-center px-2")}>
          <Button variant="ghost" size={collapsed ? "icon" : "sm"} className={cn(!collapsed && "w-full justify-start")} onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight aria-hidden /> : <><ChevronsLeft aria-hidden /> Collapse</>}
          </Button>
        </div>
      </aside>

      {/* Mobile & tablet drawer */}
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <div className="flex h-14 items-center border-b border-border px-4">
            <Logo />
          </div>
          <div className="px-3 pt-3">
            <WorkspaceSwitcher />
          </div>
          <div className="flex-1 overflow-y-auto">
            <NavLinks onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen}>
            <Menu aria-hidden />
          </Button>
          <Link href="/dashboard" className="lg:hidden" aria-label="FlowForge home">
            <Logo className="[&>span]:hidden sm:[&>span]:inline" />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationsMenu />
            <UserMenu />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}

