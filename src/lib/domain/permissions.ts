import type { GrantKey, Permission, Role, RoleGrants } from "./types";

/**
 * Baseline role → permission matrix from spec §11 (Identity and access control).
 * Configurable grants (see CONFIGURABLE_GRANTS) are layered on top per workspace.
 * This module is deterministic server-side policy; the UI only mirrors it.
 */
const BASE: Record<Role, ReadonlyArray<Permission>> = {
  owner: [
    "workflows.view", "workflows.edit", "workflows.publish",
    "runs.view", "runs.trigger", "runs.retry", "runs.cancel",
    "approvals.decide", "connections.view", "connections.manage",
    "members.view", "members.manage", "workspace.manage", "apikeys.manage", "audit.view", "workspace.delete",
  ],
  admin: [
    "workflows.view", "workflows.edit", "workflows.publish",
    "runs.view", "runs.trigger", "runs.retry", "runs.cancel",
    "approvals.decide", "connections.view", "connections.manage",
    "members.view", "members.manage", "workspace.manage", "apikeys.manage", "audit.view",
  ],
  editor: ["workflows.view", "workflows.edit", "runs.view", "runs.trigger", "connections.view", "members.view"],
  operator: ["workflows.view", "runs.view", "runs.trigger", "runs.retry", "runs.cancel", "connections.view", "members.view"],
  viewer: ["workflows.view", "runs.view", "connections.view", "members.view"],
};

export const DEFAULT_GRANTS: RoleGrants = {
  "editor:workflows.publish": true,
  "editor:runs.retry": false,
  "operator:approvals.decide": true,
  "viewer:audit.view": false,
};

export function basePermissions(role: Role): ReadonlyArray<Permission> {
  return BASE[role];
}

export function isBasePermission(role: Role, permission: Permission): boolean {
  return BASE[role].includes(permission);
}

export function can(role: Role | undefined | null, permission: Permission, grants: RoleGrants = DEFAULT_GRANTS): boolean {
  if (!role) return false;
  if (BASE[role].includes(permission)) return true;
  const key = `${role}:${permission}` as GrantKey;
  return grants[key] === true;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  operator: "Operator",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full workspace control, including usage settings and deleting the workspace.",
  admin: "Manage members, connections, workflows, approvals and workspace settings.",
  editor: "Create and edit drafts, publish if granted, configure triggers and connections.",
  operator: "View runs, retry permitted failures, cancel runs and process assigned approvals.",
  viewer: "Read-only access to workflows, runs and dashboards.",
};

export const PERMISSION_LABELS: Record<Permission, { label: string; group: string }> = {
  "workflows.view": { label: "View workflows", group: "Workflows" },
  "workflows.edit": { label: "Create and edit drafts", group: "Workflows" },
  "workflows.publish": { label: "Publish versions", group: "Workflows" },
  "runs.view": { label: "View runs and logs", group: "Executions" },
  "runs.trigger": { label: "Trigger runs manually", group: "Executions" },
  "runs.retry": { label: "Retry failed steps", group: "Executions" },
  "runs.cancel": { label: "Cancel runs", group: "Executions" },
  "approvals.decide": { label: "Approve or reject AI recovery actions", group: "Executions" },
  "connections.view": { label: "View connections", group: "Integrations" },
  "connections.manage": { label: "Create, rotate and revoke credentials", group: "Integrations" },
  "members.view": { label: "View members", group: "Administration" },
  "members.manage": { label: "Invite and manage members", group: "Administration" },
  "workspace.manage": { label: "Manage workspace settings", group: "Administration" },
  "apikeys.manage": { label: "Manage API keys", group: "Administration" },
  "audit.view": { label: "View audit log", group: "Administration" },
  "workspace.delete": { label: "Delete workspace", group: "Administration" },
};

/** Roles an actor may assign. Owners can't be assigned via invite; ownership transfer is out of MVP scope. */
export function assignableRoles(actorRole: Role): Role[] {
  if (actorRole === "owner") return ["admin", "editor", "operator", "viewer"];
  if (actorRole === "admin") return ["editor", "operator", "viewer"];
  return [];
}
