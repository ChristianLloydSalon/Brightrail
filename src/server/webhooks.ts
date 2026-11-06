import "server-only";
import { ApiError } from "@/lib/api-error";
import { decryptSecret, hmacSha256Hex, safeEqual, sha256 } from "./crypto";
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
  const eventId = headers.get("x-flowforge-event-id")?.slice(0, 120) || `sha_${sha256(raw).slice(0, 32)}${bucket}`;

  if (ep.status !== "active") {
    await record("rejected_signature", 410, eventId);
    return { status: 410, body: { code: "GONE", message: "This endpoint is disabled." } };
  }
  // Rate limit before any expensive work (signature check, JSON parse, starting a run).
  const { data: hits, error: rateErr } = await db.rpc("webhook_rate_hit", { p_endpoint: ep.id });
  if (rateErr) console.error("[flowforge] webhook rate counter failed — did you run 0002_live_limits_reads.sql?", rateErr.message);
  if (typeof hits === "number" && hits > ep.rate_limit_per_min) {
    // Only record the first rejection per window so a flood doesn't flood the delivery log too.
    if (hits === ep.rate_limit_per_min + 1) await record("rejected_rate", 429, eventId);
    const retryAfter = String(60 - new Date().getUTCSeconds());
    return { status: 429, headers: { "Retry-After": retryAfter }, body: { code: "RATE_LIMITED", message: `This endpoint accepts ${ep.rate_limit_per_min} requests per minute. Retry after ${retryAfter}s.` } };
  }
  if (bytes > ep.max_body_kb * 1024) {
    await record("rejected_size", 413, eventId);
    return { status: 413, body: { code: "PAYLOAD_TOO_LARGE", message: `Body exceeds ${ep.max_body_kb} KB.` } };
  }
  if (!opts.skipSignature && ep.verification === "url_key") {
    // Secret-link mode for form tools: the key travels in the URL (?key=…) or an X-FlowForge-Key header.
    const { data: sec } = await db.from("webhook_secrets").select("ciphertext").eq("endpoint_id", ep.id).single();
    const given = opts.key ?? headers.get("x-flowforge-key") ?? "";
    if (!given || !safeEqual(given, decryptSecret(sec!.ciphertext))) {
      await record("rejected_signature", 401, eventId);
      return { status: 401, body: { code: "BAD_KEY", message: "The webhook link's key is missing or wrong. Copy the full link again (rotate the secret to get a new one)." } };
    }
  } else if (!opts.skipSignature) {
    const ts = Number(headers.get("x-flowforge-timestamp"));
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > ep.replay_window_sec) {
      await record("rejected_replay", 401, eventId);
      return { status: 401, body: { code: "REPLAY_WINDOW", message: "Timestamp missing or outside the replay window." } };
    }
    const { data: sec } = await db.from("webhook_secrets").select("ciphertext").eq("endpoint_id", ep.id).single();
    const expected = `sha256=${hmacSha256Hex(decryptSecret(sec!.ciphertext), `${ts}.${raw}`)}`;
    if (!safeEqual(headers.get("x-flowforge-signature") ?? "", expected)) {
      await record("rejected_signature", 401, eventId);
      return { status: 401, body: { code: "BAD_SIGNATURE", message: "Signature verification failed." } };
    }
  }
  const { data: dup } = await db.from("webhook_deliveries").select("run_id").eq("endpoint_id", ep.id).eq("event_id", eventId).eq("status", "accepted").maybeSingle();
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
  const { data: delivery, error } = await db.from("webhook_deliveries").insert({ workspace_id: ep.workspace_id, endpoint_id: ep.id, event_id: eventId, status: "accepted", http_status: 202, bytes }).select("id").single();
  if (error) return { status: 200, body: { duplicate: true } };
  try {
    const run = await startRun({ workspaceId: ep.workspace_id, workflow: wf!, input: payload, trigger: { source: "webhook", detail: `POST /api/v1/webhooks/${ep.id}${opts.skipSignature ? " (test event)" : ""}` } });
    await db.from("webhook_deliveries").update({ run_id: run.id }).eq("id", delivery!.id);
    return { status: 202, body: { accepted: true, runId: run.id } };
  } catch (e) {
    const quota = e instanceof ApiError && e.code === "RATE_LIMITED";
    await db.from("webhook_deliveries").update({ http_status: quota ? 429 : 409 }).eq("id", delivery!.id);
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
