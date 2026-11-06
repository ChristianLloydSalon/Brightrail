/**
 * Client-side mirror of the SSRF rules in spec §11. The API and worker must re-validate
 * (including DNS resolution and redirects) — this only gives the editor early feedback.
 */
export type UrlCheck = { ok: true } | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

export function ipv4Blocked(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export function checkOutboundUrl(raw: string): UrlCheck {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "Enter a URL." };
  // Template expressions such as {{order.id}} are allowed in the path and query only; the host must be literal.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "Enter a full URL, for example https://api.example.com/orders." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only HTTPS URLs are allowed." };
  if (url.username || url.password) return { ok: false, reason: "Don't put credentials in the URL. Use a connection instead." };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "Internal and loopback hosts are blocked." };
  }
  if (ipv4Blocked(host)) return { ok: false, reason: "Private, loopback and link-local IP ranges are blocked." };
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return { ok: false, reason: "Private and link-local IPv6 ranges are blocked." };
  }
  if (!host.includes(".")) return { ok: false, reason: "Use a fully qualified public hostname." };
  return { ok: true };
}

/** True for IPv4/IPv6 addresses the worker must never connect to (used after DNS resolution). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return ipv4Blocked(v.slice(7));
  if (v.includes(":")) return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  return ipv4Blocked(v);
}
