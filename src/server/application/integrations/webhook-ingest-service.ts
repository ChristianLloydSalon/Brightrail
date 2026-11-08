import { ApiError } from "@/lib/api-error";
import type { WebhookEndpoint } from "@/lib/domain/types";
import { UNSAFE_KEYS } from "@/lib/utils";
import type { DeliveryRepository, DeliveryStatus, WebhookRepository, WorkflowRepository } from "../ports/repositories";
import type { AppConfig, Hasher, RateLimiter, SecretStore } from "../ports/services";
import type { RunLauncher } from "../runs/run-launcher";

export interface IngestResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Reads a Brightrail header, falling back to its pre-rename x-flowforge-* spelling. */
const hdr = (h: Headers, name: string) => h.get(`x-brightrail-${name}`) ?? h.get(`x-flowforge-${name}`);

/** HTML-form bodies → object. Repeated names become lists; names like a[b] stay as written. */
export function formToObject(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    if (UNSAFE_KEYS.has(k)) continue;
    const cur = out[k];
    out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  return out;
}

/** JSON or form body → trigger payload, or null if it can't be parsed. */
function parsePayload(raw: string, contentType: string): Record<string, unknown> | null {
  if (contentType.toLowerCase().includes("application/x-www-form-urlencoded")) return formToObject(raw);
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return null;
  }
}

/** One inbound request: the endpoint, the raw body and what has been learned about it so far. */
class Delivery {
  readonly bytes: number;
  readonly eventId: string;
  /** HMAC mode: the event-id header isn't signed, so also dedupe on what was signed (set after verification). */
  signatureKey: string | null = null;

  constructor(
    readonly ep: WebhookEndpoint,
    readonly raw: string,
    readonly headers: Headers,
    hasher: Hasher,
  ) {
    this.bytes = Buffer.byteLength(raw);
    // Without an event ID, identical bodies count as one delivery. For secret-link senders (forms) that
    // only applies within 10 minutes — enough to absorb sender retries, not to block a repeat submission.
    const bucket = ep.verification === "url_key" ? `_${Math.floor(Date.now() / 600_000)}` : "";
    this.eventId = hdr(headers, "event-id")?.slice(0, 120) || `sha_${hasher.sha256(raw).slice(0, 32)}${bucket}`;
  }
}

/**
 * Webhook security contract (spec §10): body size, replay window, constant-time HMAC or key check,
 * rate limits, idempotency record before starting the workflow, stable response for duplicates.
 * Each check either rejects the delivery (and logs why) or lets it continue to the next.
 */
export class WebhookIngestService {
  constructor(
    private readonly webhooks: WebhookRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly workflows: WorkflowRepository,
    private readonly secrets: SecretStore,
    private readonly hasher: Hasher,
    private readonly limiter: RateLimiter,
    private readonly launcher: RunLauncher,
    private readonly config: AppConfig,
  ) {}

  private record(d: Delivery, status: DeliveryStatus, http: number, runId?: string) {
    return this.deliveries.record({ workspaceId: d.ep.workspaceId, endpointId: d.ep.id, eventId: d.eventId, status, httpStatus: http, bytes: d.bytes, runId });
  }

  private rateLimited(ep: WebhookEndpoint): IngestResult {
    const retryAfter = String(60 - new Date().getUTCSeconds());
    return { status: 429, headers: { "Retry-After": retryAfter }, body: { code: "RATE_LIMITED", message: `This endpoint accepts ${ep.rateLimitPerMin} requests per minute. Retry after ${retryAfter}s.` } };
  }

  async ingest(endpointId: string, raw: string, headers: Headers, opts: { skipSignature?: boolean; key?: string | null } = {}): Promise<IngestResult> {
    const ep = await this.webhooks.findById(endpointId);
    if (!ep) return { status: 404, body: { code: "NOT_FOUND", message: "Unknown webhook endpoint." } };
    const d = new Delivery(ep, raw, headers, this.hasher);

    if (ep.status !== "active") {
      await this.record(d, "rejected_signature", 410);
      return { status: 410, body: { code: "GONE", message: "This endpoint is disabled." } };
    }
    // Flood guard before any database-heavy work. It is deliberately much looser than the endpoint's own
    // limit, which counts only authenticated deliveries (below) so unsigned junk can't use up a sender's budget.
    const flood = await this.limiter.hit(`webhook-any:${ep.id}`, 60);
    if (flood.error !== undefined) console.error("[brightrail] webhook flood counter unavailable — run 0008_security_fixes.sql", flood.error);
    else if (typeof flood.count === "number" && flood.count > Math.max(ep.rateLimitPerMin * 10, 600)) return this.rateLimited(ep);
    if (d.bytes > ep.maxBodyKb * 1024) {
      await this.record(d, "rejected_size", 413);
      return { status: 413, body: { code: "PAYLOAD_TOO_LARGE", message: `Body exceeds ${ep.maxBodyKb} KB.` } };
    }
    if (!opts.skipSignature) {
      const rejected = ep.verification === "url_key" ? await this.verifyKey(d, opts.key ?? null) : await this.verifySignature(d);
      if (rejected) return rejected;
    }
    // The endpoint's configured limit counts authenticated deliveries only.
    const rate = await this.limiter.webhookHit(ep.id);
    if (rate.error !== undefined) {
      console.error("[brightrail] webhook rate counter failed — did you run 0002_live_limits_reads.sql?", rate.error);
      if (this.config.production) return { status: 503, body: { code: "UNAVAILABLE", message: "Webhook intake is temporarily unavailable. Retry shortly." } };
    }
    if (typeof rate.count === "number" && rate.count > ep.rateLimitPerMin) {
      // Only record the first rejection per window so a flood doesn't flood the delivery log too.
      if (rate.count === ep.rateLimitPerMin + 1) await this.record(d, "rejected_rate", 429);
      return this.rateLimited(ep);
    }
    const dup = (await this.deliveries.acceptedRunByEvent(ep.id, d.eventId)) ?? (d.signatureKey ? await this.deliveries.acceptedRunBySignature(ep.id, d.signatureKey) : null);
    if (dup) {
      await this.record(d, "duplicate", 200, dup.runId ?? undefined);
      return { status: 200, body: { duplicate: true, runId: dup.runId } };
    }
    const payload = parsePayload(raw, headers.get("content-type") ?? "");
    if (!payload) return { status: 400, body: { code: "INVALID_JSON", message: "Send JSON (Content-Type: application/json) or a form (application/x-www-form-urlencoded)." } };
    return this.accept(d, payload, !!opts.skipSignature);
  }

  /** Secret-link mode for form tools: the key travels in the URL (?key=…) or an X-Brightrail-Key header. */
  private async verifyKey(d: Delivery, urlKey: string | null): Promise<IngestResult | null> {
    const secret = await this.secrets.read(d.ep.id);
    // URLs end up in access logs, so an endpoint can insist on the header.
    const given = (d.ep.headerKeyOnly ? null : urlKey) ?? hdr(d.headers, "key") ?? "";
    if (given && secret && this.hasher.safeEqual(given, secret)) return null;
    await this.record(d, "rejected_signature", 401);
    return { status: 401, body: { code: "BAD_KEY", message: "The webhook link's key is missing or wrong. Copy the full link again (rotate the secret to get a new one)." } };
  }

  private async verifySignature(d: Delivery): Promise<IngestResult | null> {
    const ts = Number(hdr(d.headers, "timestamp"));
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > d.ep.replayWindowSec) {
      await this.record(d, "rejected_replay", 401);
      return { status: 401, body: { code: "REPLAY_WINDOW", message: "Timestamp missing or outside the replay window." } };
    }
    // A missing secret must never degrade to an HMAC with an empty (guessable) key.
    const secret = await this.secrets.read(d.ep.id);
    const expected = secret ? `sha256=${this.hasher.hmacSha256Hex(secret, `${ts}.${d.raw}`)}` : null;
    if (!expected || !this.hasher.safeEqual(hdr(d.headers, "signature") ?? "", expected)) {
      await this.record(d, "rejected_signature", 401);
      return { status: 401, body: { code: "BAD_SIGNATURE", message: "Signature verification failed." } };
    }
    // Replaying the same signed delivery with a different (or no) event-id header is still a duplicate.
    d.signatureKey = this.hasher.sha256(`${ts}.${d.raw}`);
    return null;
  }

  /** Persists the idempotency record first, then starts the run. */
  private async accept(d: Delivery, payload: Record<string, unknown>, test: boolean): Promise<IngestResult> {
    const wf = await this.workflows.runnable(d.ep.workflowId);
    const deliveryId = await this.deliveries.insertAccepted({ workspaceId: d.ep.workspaceId, endpointId: d.ep.id, eventId: d.eventId, bytes: d.bytes, signatureKey: d.signatureKey });
    if (!deliveryId) return { status: 200, body: { duplicate: true } };
    try {
      const run = await this.launcher.start({ workspaceId: d.ep.workspaceId, workflow: wf!, input: payload, trigger: { source: "webhook", detail: `POST /api/v1/webhooks/${d.ep.id}${test ? " (test event)" : ""}` } });
      await this.deliveries.attachRun(deliveryId, run.id);
      return { status: 202, body: { accepted: true, runId: run.id } };
    } catch (e) {
      const quota = e instanceof ApiError && e.code === "RATE_LIMITED";
      // No run started, so release the idempotency record: the sender's retry (once the workflow is
      // resumed or quota frees up) must be accepted, not swallowed as a duplicate. Keep a log entry.
      await this.deliveries.delete(deliveryId);
      await this.record(d, "not_started", quota ? 429 : 409);
      return { status: quota ? 429 : 409, body: { code: quota ? "QUOTA_EXCEEDED" : "NOT_ACCEPTING", message: (e as Error).message } };
    }
  }
}
