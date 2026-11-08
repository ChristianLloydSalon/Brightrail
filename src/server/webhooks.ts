import "server-only";
import { ApiError } from "@/lib/api-error";
import { decryptSecret, hmacSha256Hex, safeEqual, sha256, webhookSecretContext } from "./crypto";
import { startRun } from "./engine/runs";
import { adminClient } from "./supabase";

export interface IngestResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Webhook security contract (spec §10): body size, replay window, constant-time HMAC check,
 * idempotency record before starting the workflow, stable response for duplicates.
 */
/** Reads a Brightrail header, falling back to its pre-rename x-flowforge-* spelling. */
const hdr = (h: Headers, name: string) => h.get(`x-brightrail-${name}`) ?? h.get(`x-flowforge-${name}`);

export async function ingestWebhook(endpointId: string, raw: string, headers: Headers, opts: { skipSignature?: boolean; key?: string | null } = {}): Promise<IngestResult> {
  const db = adminClient();
  const { data: ep } = await db.from("webhook_endpoints").select("*").eq("id", endpointId).maybeSingle();
  if (!ep) return { status: 404, body: { code: "NOT_FOUND", message: "Unknown webhook endpoint." } };
  const bytes = Buffer.byteLength(raw);
  const record = async (status: string, http: number, eventId: string, runId?: string) => {
    await db.from("webhook_deliveries").insert({ workspace_id: ep.workspace_id, endpoint_id: ep.id, event_id: eventId, status, http_status: http, bytes, run_id: runId ?? null });
  };
  // Without an event ID, identical bodies count as one delivery. For secret-link senders (forms) that
  // only applies within 10 minutes — enough to absorb sender retries, not to block a repeat submission.
  const bucket = ep.verification === "url_key" ? `_${Math.floor(Date.now() / 600_000)}` : "";
  const eventId = hdr(headers, "event-id")?.slice(0, 120) || `sha_${sha256(raw).slice(0, 32)}${bucket}`;
  // HMAC mode: the event-id header isn't signed, so also dedupe on what was signed (set after verification).
  let signatureKey: string | null = null;

  if (ep.status !== "active") {
    await record("rejected_signature", 410, eventId);
    return { status: 410, body: { code: "GONE", message: "This endpoint is disabled." } };
  }
  const retryAfter = () => String(60 - new Date().getUTCSeconds());
  const rateLimited = () => ({ status: 429, headers: { "Retry-After": retryAfter() }, body: { code: "RATE_LIMITED", message: `This endpoint accepts ${ep.rate_limit_per_min} requests per minute. Retry after ${retryAfter()}s.` } });
  // Flood guard before any database-heavy work. It is deliberately much looser than the endpoint's own
  // limit, which counts only authenticated deliveries (below) so unsigned junk can't use up a sender's budget.
  const { data: rawHits, error: floodErr } = await db.rpc("rate_hit", { p_key: `webhook-any:${ep.id}`, p_window_sec: 60 });
  if (floodErr) console.error("[brightrail] webhook flood counter unavailable — run 0008_security_fixes.sql", floodErr.message);
  else if (typeof rawHits === "number" && rawHits > Math.max(ep.rate_limit_per_min * 10, 600)) return rateLimited();
  if (bytes > ep.max_body_kb * 1024) {
    await record("rejected_size", 413, eventId);
    return { status: 413, body: { code: "PAYLOAD_TOO_LARGE", message: `Body exceeds ${ep.max_body_kb} KB.` } };
  }
  if (!opts.skipSignature && ep.verification === "url_key") {
    // Secret-link mode for form tools: the key travels in the URL (?key=…) or an X-Brightrail-Key header.
    const { data: sec } = await db.from("webhook_secrets").select("ciphertext").eq("endpoint_id", ep.id).single();
    // URLs end up in access logs, so an endpoint can insist on the header.
    const given = (ep.header_key_only ? null : opts.key) ?? hdr(headers, "key") ?? "";
    if (!given || !safeEqual(given, decryptSecret(sec!.ciphertext, webhookSecretContext(ep.id)))) {
      await record("rejected_signature", 401, eventId);
      return { status: 401, body: { code: "BAD_KEY", message: "The webhook link's key is missing or wrong. Copy the full link again (rotate the secret to get a new one)." } };
    }
  } else if (!opts.skipSignature) {
    const ts = Number(hdr(headers, "timestamp"));
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > ep.replay_window_sec) {
      await record("rejected_replay", 401, eventId);
      return { status: 401, body: { code: "REPLAY_WINDOW", message: "Timestamp missing or outside the replay window." } };
    }
    const { data: sec } = await db.from("webhook_secrets").select("ciphertext").eq("endpoint_id", ep.id).single();
    const expected = `sha256=${hmacSha256Hex(decryptSecret(sec!.ciphertext, webhookSecretContext(ep.id)), `${ts}.${raw}`)}`;
    if (!safeEqual(hdr(headers, "signature") ?? "", expected)) {
      await record("rejected_signature", 401, eventId);
      return { status: 401, body: { code: "BAD_SIGNATURE", message: "Signature verification failed." } };
    }
    // Replaying the same signed delivery with a different (or no) event-id header is still a duplicate.
    signatureKey = sha256(`${ts}.${raw}`);
  }
  // The endpoint's configured limit counts authenticated deliveries only.
  const { data: hits, error: rateErr } = await db.rpc("webhook_rate_hit", { p_endpoint: ep.id });
  if (rateErr) {
    console.error("[brightrail] webhook rate counter failed — did you run 0002_live_limits_reads.sql?", rateErr.message);
    if (process.env.NODE_ENV === "production") return { status: 503, body: { code: "UNAVAILABLE", message: "Webhook intake is temporarily unavailable. Retry shortly." } };
  }
  if (typeof hits === "number" && hits > ep.rate_limit_per_min) {
    // Only record the first rejection per window so a flood doesn't flood the delivery log too.
    if (hits === ep.rate_limit_per_min + 1) await record("rejected_rate", 429, eventId);
    return rateLimited();
  }
  const { data: dupById } = await db.from("webhook_deliveries").select("run_id").eq("endpoint_id", ep.id).eq("event_id", eventId).eq("status", "accepted").maybeSingle();
  let dup = dupById;
  if (!dup && signatureKey) {
    // Needs 0008_security_fixes.sql; without the column this lookup errors and is skipped.
    const { data, error: sigErr } = await db.from("webhook_deliveries").select("run_id").eq("endpoint_id", ep.id).eq("signature_key", signatureKey).eq("status", "accepted").maybeSingle();
    if (sigErr) console.error("[brightrail] webhook signature dedupe unavailable — run supabase/migrations/0008_security_fixes.sql", sigErr.message);
    dup = data;
  }
  if (dup) {
    await record("duplicate", 200, eventId, dup.run_id ?? undefined);
    return { status: 200, body: { duplicate: true, runId: dup.run_id } };
  }
  let payload: Record<string, unknown>;
  const type = (headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) {
    payload = formToObject(raw);
  } else {
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
    } catch {
      return { status: 400, body: { code: "INVALID_JSON", message: "Send JSON (Content-Type: application/json) or a form (application/x-www-form-urlencoded)." } };
    }
  }
  const { data: wf } = await db.from("workflows").select("id, name, status, current_version_id").eq("id", ep.workflow_id).single();
  // Persist the idempotency record first, then start the run.
  const accepted: Record<string, unknown> = { workspace_id: ep.workspace_id, endpoint_id: ep.id, event_id: eventId, status: "accepted", http_status: 202, bytes };
  let { data: delivery, error } = await db.from("webhook_deliveries").insert(signatureKey ? { ...accepted, signature_key: signatureKey } : accepted).select("id").single();
  if (error && signatureKey && /signature_key/.test(error.message)) {
    // Column missing (migration 0008 not applied yet): fall back to event-id-only idempotency.
    ({ data: delivery, error } = await db.from("webhook_deliveries").insert(accepted).select("id").single());
  }
  if (error) return { status: 200, body: { duplicate: true } };
  try {
    const run = await startRun({ workspaceId: ep.workspace_id, workflow: wf!, input: payload, trigger: { source: "webhook", detail: `POST /api/v1/webhooks/${ep.id}${opts.skipSignature ? " (test event)" : ""}` } });
    await db.from("webhook_deliveries").update({ run_id: run.id }).eq("id", delivery!.id);
    return { status: 202, body: { accepted: true, runId: run.id } };
  } catch (e) {
    const quota = e instanceof ApiError && e.code === "RATE_LIMITED";
    // No run started, so release the idempotency record: the sender's retry (once the workflow is
    // resumed or quota frees up) must be accepted, not swallowed as a duplicate. Keep a log entry.
    await db.from("webhook_deliveries").delete().eq("id", delivery!.id);
    await record("not_started", quota ? 429 : 409, eventId);
    return { status: quota ? 429 : 409, body: { code: quota ? "QUOTA_EXCEEDED" : "NOT_ACCEPTING", message: (e as Error).message } };
  }
}

/** HTML-form bodies → object. Repeated names become lists; names like a[b] stay as written. */
export function formToObject(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const cur = out[k];
    out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  return out;
}
