import "server-only";
import { AccountService } from "./application/account/account-service";
import { AuthEmailService } from "./application/account/auth-email-service";
import { ApiKeyService } from "./application/admin/api-key-service";
import { AuditService } from "./application/admin/audit-service";
import { DashboardService } from "./application/admin/dashboard-service";
import { InvitationSender } from "./application/admin/invitation-sender";
import { MemberService } from "./application/admin/member-service";
import { WorkspaceService } from "./application/admin/workspace-service";
import { RunEngine } from "./application/engine/run-engine";
import { ScheduleService } from "./application/engine/schedule-service";
import { ConnectionService } from "./application/integrations/connection-service";
import { WebhookEndpointService } from "./application/integrations/webhook-endpoint-service";
import { WebhookIngestService } from "./application/integrations/webhook-ingest-service";
import { NotificationService } from "./application/notifications/notification-service";
import type { AppConfig } from "./application/ports/services";
import { ApprovalExpiryService } from "./application/runs/approval-expiry-service";
import { ApprovalService } from "./application/runs/approval-service";
import { RunLauncher } from "./application/runs/run-launcher";
import { RunFinder, RunResumer, RunService } from "./application/runs/run-service";
import { AuditLog } from "./application/shared/audit-log";
import { HourlyQuota } from "./application/shared/throttle";
import { WorkflowService } from "./application/workflows/workflow-service";
import { GeminiFailureAdvisor } from "./infrastructure/ai/gemini-advisor";
import { SupabaseAuthProviders } from "./infrastructure/auth/auth-providers";
import { SessionResolver } from "./infrastructure/auth/session-resolver";
import { SupabaseIdentityAdmin } from "./infrastructure/auth/supabase-identity";
import { CookieWorkspacePreference } from "./infrastructure/auth/workspace-cookie";
import { env } from "./infrastructure/config/env";
import { ResendAuthMailer } from "./infrastructure/email/resend-auth-mailer";
import { RegistryConnectionTester } from "./infrastructure/executors/connection-testers";
import { CredentialBinder, WorkflowNodeExecutor } from "./infrastructure/executors/node-executors";
import { InngestEventBus } from "./infrastructure/inngest/event-bus";
import { EncryptedSecretStore, NodeHasher } from "./infrastructure/security/secret-store";
import { adminClient } from "./infrastructure/supabase/clients";
import { DEFAULT_SETTINGS } from "./infrastructure/supabase/mappers";
import { SupabaseApiKeyRepository, SupabaseAuditRepository, SupabaseNotificationRepository, SupabaseRateLimiter } from "./infrastructure/supabase/repositories/admin";
import { SupabaseAnalysisRepository, SupabaseApprovalRepository } from "./infrastructure/supabase/repositories/approvals";
import { SupabaseConnectionRepository, SupabaseDeliveryRepository, SupabaseWebhookRepository } from "./infrastructure/supabase/repositories/integrations";
import { SupabaseMemberRepository, SupabaseProfileRepository, SupabaseWorkspaceRepository } from "./infrastructure/supabase/repositories/people";
import { SupabaseRunRepository, SupabaseScheduleRepository } from "./infrastructure/supabase/repositories/runs";
import { SupabaseVersionRepository, SupabaseWorkflowRepository } from "./infrastructure/supabase/repositories/workflows";

/**
 * Composition root: the only module that knows every concrete class. It wires the Supabase, Inngest,
 * Resend and crypto adapters into the application services. Nothing connects until first use, so the
 * container can be built even when configuration is missing (requests then get NOT_CONFIGURED).
 */
function build() {
  const db = adminClient; // provider: resolved on each query
  const config: AppConfig = { appUrl: env.appUrl, emailNotificationsAvailable: !!(env.resendApiKey && env.emailFrom), production: process.env.NODE_ENV === "production" };

  const repos = {
    workspaces: new SupabaseWorkspaceRepository(db),
    members: new SupabaseMemberRepository(db),
    profiles: new SupabaseProfileRepository(db),
    workflows: new SupabaseWorkflowRepository(db),
    versions: new SupabaseVersionRepository(db),
    runs: new SupabaseRunRepository(db),
    schedules: new SupabaseScheduleRepository(db),
    approvals: new SupabaseApprovalRepository(db),
    analyses: new SupabaseAnalysisRepository(db),
    connections: new SupabaseConnectionRepository(db),
    webhooks: new SupabaseWebhookRepository(db),
    deliveries: new SupabaseDeliveryRepository(db),
    apiKeys: new SupabaseApiKeyRepository(db),
    audit: new SupabaseAuditRepository(db),
    notifications: new SupabaseNotificationRepository(db),
  };

  const bus = new InngestEventBus();
  const limiter = new SupabaseRateLimiter(db);
  const hasher = new NodeHasher();
  const connectionSecrets = EncryptedSecretStore.forConnections(db);
  const webhookSecrets = EncryptedSecretStore.forWebhooks(db);
  const preference = new CookieWorkspacePreference();
  const identity = new SupabaseIdentityAdmin(db);
  const mailer = new ResendAuthMailer();
  const tester = new RegistryConnectionTester();
  const executor = new WorkflowNodeExecutor(new CredentialBinder(repos.connections, connectionSecrets));
  const auditLog = new AuditLog(repos.audit);
  const quota = new HourlyQuota(limiter, config);

  const notifications = new NotificationService(repos.notifications, repos.members, repos.profiles, repos.workspaces, repos.approvals, bus, config);
  const launcher = new RunLauncher(repos.runs, repos.versions, repos.workspaces, bus);
  const schedules = new ScheduleService(repos.schedules, repos.workflows, repos.versions, launcher, bus);
  const finder = new RunFinder(repos.runs);
  const resumer = new RunResumer(repos.runs, bus);
  const approvalExpiry = new ApprovalExpiryService(repos.approvals, repos.runs, bus, auditLog);
  const ingest = new WebhookIngestService(repos.webhooks, repos.deliveries, repos.workflows, webhookSecrets, hasher, limiter, launcher, config);

  return {
    repos,
    config,
    session: new SessionResolver(db, repos.members, preference),
    authProviders: new SupabaseAuthProviders(),
    notifications,
    launcher,
    schedules,
    approvalExpiry,
    ingest,
    runEngine: new RunEngine(repos.runs, repos.versions, repos.workspaces, repos.approvals, executor, notifications, auditLog),
    workflows: new WorkflowService(repos.workflows, repos.versions, repos.runs, repos.profiles, repos.webhooks, repos.schedules, repos.connections, launcher, schedules, auditLog),
    runs: new RunService(repos.runs, repos.versions, repos.workflows, repos.approvals, repos.analyses, finder, resumer, launcher, bus, auditLog),
    approvals: new ApprovalService(repos.approvals, repos.analyses, repos.runs, repos.versions, repos.workflows, repos.connections, finder, resumer, approvalExpiry, new GeminiFailureAdvisor(), limiter, notifications, auditLog, config),
    connections: new ConnectionService(repos.connections, repos.webhooks, repos.schedules, repos.workflows, connectionSecrets, tester, auditLog),
    webhooks: new WebhookEndpointService(repos.webhooks, repos.deliveries, repos.workflows, webhookSecrets, hasher, ingest, auditLog, config),
    workspace: new WorkspaceService(repos.workspaces, repos.members, repos.runs, repos.connections, preference, auditLog),
    members: new MemberService(repos.members, repos.profiles, new InvitationSender(identity, mailer, config), quota, auditLog),
    apiKeys: new ApiKeyService(repos.apiKeys, repos.members, repos.profiles, hasher, auditLog),
    audit: new AuditService(repos.audit),
    dashboard: new DashboardService(repos.workflows, repos.runs, repos.connections, repos.members, repos.approvals, repos.audit),
    account: new AccountService(repos.profiles, repos.members, repos.workspaces, repos.workflows, repos.apiKeys, identity, preference, auditLog, config, DEFAULT_SETTINGS),
    authEmails: new AuthEmailService(identity, mailer, config),
  };
}

export type Container = ReturnType<typeof build>;

let instance: Container | null = null;

/** The process-wide container (services are stateless, so one instance serves every request). */
export function container(): Container {
  instance ??= build();
  return instance;
}
