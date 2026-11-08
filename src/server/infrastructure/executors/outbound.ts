import "server-only";
import { lookup } from "node:dns/promises";
import type { JsonValue } from "@/lib/domain/types";
import { checkOutboundUrl, isPrivateAddress } from "@/lib/domain/url-safety";
import { classifyHttpStatus, type StepFailure } from "@/lib/engine/logic";
import { pinnedRequest, type PinnedResponse } from "../http/http-transport";

const MAX_BODY = 64 * 1024;

/** An error carrying the StepFailure a step should report. */
export const stepError = (failure: StepFailure, extra: Record<string, unknown> = {}) => Object.assign(new Error(failure.message), { failure, ...extra });

/** Resolves the hostname and refuses private/loopback/metadata addresses (DNS rebinding defence). */
export async function assertPublicHost(url: string) {
  const check = checkOutboundUrl(url);
  if (!check.ok) throw stepError({ code: "SSRF_BLOCKED", message: check.reason, errorClass: "configuration", retryable: false });
  const host = new URL(url).hostname;
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw stepError({ code: "DNS_LOOKUP_FAILED", message: `Couldn't resolve ${host}.`, errorClass: "transient", retryable: true });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw stepError({ code: "SSRF_BLOCKED", message: `${host} resolves to a private address. Only public hosts are allowed.`, errorClass: "configuration", retryable: false });
  return addrs[0]!;
}

/** One outbound request to a vetted public host; non-2xx and redirects become StepFailures. */
export async function send(url: string, init: { method: string; headers: Record<string, string>; body?: string; timeoutSec: number }, provider: string): Promise<{ status: number; body: JsonValue }> {
  // Connect to the exact address that was just checked, so a second DNS answer can't point elsewhere.
  const pin = await assertPublicHost(url);
  let res: PinnedResponse;
  try {
    res = await pinnedRequest(url, { method: init.method, headers: init.headers, body: init.body }, pin, init.timeoutSec * 1000, MAX_BODY);
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw stepError(timeout
      ? { code: "PROVIDER_TIMEOUT", message: `${provider} didn't respond within ${init.timeoutSec}s.`, errorClass: "transient", retryable: true }
      : { code: "NETWORK_ERROR", message: `Couldn't reach ${provider}: ${(e as Error).message}`, errorClass: "transient", retryable: true });
  }
  if (res.status >= 300 && res.status < 400)
    throw stepError({ code: `HTTP_${res.status}_REDIRECT`, message: `${provider} returned a redirect. Redirects aren't followed; use the final URL.`, errorClass: "configuration", retryable: false });
  const text = res.text;
  let body: JsonValue = text;
  try {
    body = text ? (JSON.parse(text) as JsonValue) : null;
  } catch {
    /* keep text */
  }
  if (res.status < 200 || res.status >= 300) throw stepError(classifyHttpStatus(res.status, provider), { body });
  return { status: res.status, body };
}

/**
 * True when `url` is on the same origin as `base` and its path is the base path or below it (segment-bounded).
 * A plain string prefix would let "https://api.example.com.attacker.example/" match "https://api.example.com".
 */
export function withinBase(url: string, base: string): boolean {
  try {
    const u = new URL(url);
    const b = new URL(base);
    if (u.origin !== b.origin) return false;
    const prefix = b.pathname.endsWith("/") ? b.pathname : `${b.pathname}/`;
    return u.pathname === b.pathname || u.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
