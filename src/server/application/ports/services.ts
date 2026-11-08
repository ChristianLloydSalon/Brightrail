import type { AdvisorInput, AdvisorOutput } from "@/lib/ai/advisor";
import type { JsonValue, WorkflowNode } from "@/lib/domain/types";
import type { StepFailure } from "@/lib/engine/logic";

/** Gateways to everything outside the application core: time, queues, secrets, email, vendors, AI. */

export interface Clock {
  now(): Date;
  iso(): string;
}

/** Durable-workflow events (implemented with Inngest). Events with an `id` are de-duplicated. */
export interface ScheduleTick { workflowId: string; version: number; at: string }
export interface EventBus {
  requestRun(data: { runId: string; pass: number; resumeFromNodeId?: string }, id?: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  approvalRequested(approvalId: string, expiresAt: string): Promise<void>;
  scheduleTick(tick: ScheduleTick): Promise<void>;
  notificationCreated(notificationId: string): Promise<void>;
}

/** Sliding-window counters kept in Postgres. `null` means the counter is unavailable (migration missing). */
export interface RateLimiter {
  hit(key: string, windowSec: number): Promise<{ count: number | null; error?: string }>;
  webhookHit(endpointId: string): Promise<{ count: number | null; error?: string }>;
}

/** Encrypted credential storage, bound to the record it belongs to. */
export interface SecretStore {
  read(ownerId: string): Promise<string | null>;
  write(ownerId: string, plain: string): Promise<void>;
  remove(ownerId: string): Promise<void>;
}

export interface Hasher {
  sha256(value: string): string;
  hmacSha256Hex(secret: string, value: string): string;
  safeEqual(a: string, b: string): boolean;
  randomToken(prefix: string, bytes?: number): string;
}

/** Remembers which workspace this browser was last using (a preference, never an authorization). */
export interface WorkspacePreference {
  get(): Promise<string | undefined>;
  set(workspaceId: string): Promise<void>;
  clear(): Promise<void>;
}

export type EmailLinkType = "signup" | "recovery" | "invite" | "magiclink";

/** Brightrail's own transactional email (Resend), used instead of Supabase's sender when configured. */
export interface AuthMailer {
  enabled(): boolean;
  send(to: string, subject: string, lines: string[], button: { label: string; url: string }, idempotencyKey: string): Promise<void>;
  callbackLink(tokenHash: string, type: EmailLinkType, next?: string, binding?: string): string;
  bindLinkToThisBrowser(): Promise<string>;
  throttle(kind: string, email: string): Promise<void>;
}

export type GeneratedLink = { userId: string | null; hashedToken: string | null; emailConfirmed: boolean; error?: string };

/** Admin operations on the identity provider (Supabase Auth). */
export interface IdentityAdmin {
  confirmedEmail(userId: string): Promise<string | null>;
  /** Throws an ApiError that says how to fix the problem if the provider refuses. */
  deleteUser(userId: string): Promise<void>;
  generateLink(type: EmailLinkType, email: string, options?: { password?: string; data?: Record<string, unknown>; redirectTo?: string }): Promise<GeneratedLink>;
  inviteUserByEmail(email: string, options: { redirectTo: string; data: Record<string, unknown> }): Promise<{ userId: string | null; error?: string }>;
}

/** The run a step belongs to. `scope` identifies a loop iteration, so retries and idempotency keys stay per item. */
export type RunRef = { id: string; workspaceId: string; scope?: string };

export type ExecResult =
  | { ok: true; input: JsonValue; output: JsonValue; branch?: "true" | "false"; data: Record<string, unknown> }
  | { ok: false; input: JsonValue; failure: StepFailure };

/** Runs one node: at most one external side effect, JSON-safe redacted result. */
export interface NodeExecutor {
  execute(node: WorkflowNode, data: Record<string, unknown>, run: RunRef): Promise<ExecResult>;
}

/** The cheapest authenticated check for a connector. Never sends a message. */
export interface ConnectionTester {
  test(integrationId: string, config: Record<string, string>, secret: string): Promise<{ ok: boolean; message: string }>;
}

export interface FailureAdvisor {
  analyze(input: AdvisorInput): Promise<AdvisorOutput>;
}

/** Server configuration values the application needs (no secrets). */
export interface AppConfig {
  appUrl: string;
  /** Brightrail can send notification emails (RESEND_API_KEY + EMAIL_FROM). */
  emailNotificationsAvailable: boolean;
  production: boolean;
}
