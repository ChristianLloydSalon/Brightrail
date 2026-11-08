/**
 * Client-side mirror of the SSRF rules in spec §11. The API and worker must re-validate
 * (including DNS resolution and redirects) — this only gives the editor early feedback.
 */
export type UrlCheck = { ok: true } | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

export function ipv4Blocked(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expands an IPv6 address (optionally with a trailing dotted IPv4) to eight 16-bit groups, or null. */
function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase().split("%")[0]!;
  const v4 = v.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const p = v4[1]!.split(".").map(Number);
    if (p.some((n) => n > 255)) return null;
    v = v.slice(0, -v4[1]!.length) + `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((g) => !Number.isNaN(g)) ? groups : null;
}

const v4FromGroups = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function ipv6Blocked(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return true; // unparseable: refuse
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return ipv4Blocked(v4FromGroups(g6, g7)); // mapped / compatible
  if (g0 === 0x64 && g1 === 0xff9b) return ipv4Blocked(v4FromGroups(g6, g7)) || (g2 === 1); // NAT64 (incl. local-use 64:ff9b:1::/48)
  if (g0 === 0x2002) return ipv4Blocked(v4FromGroups(g1, g2)); // 6to4
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true; // link-local fe80::/10, site-local fec0::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
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
  if (host.includes(":") && ipv6Blocked(host)) {
    return { ok: false, reason: "Private and link-local IPv6 ranges are blocked." };
  }
  if (!host.includes(".")) return { ok: false, reason: "Use a fully qualified public hostname." };
  return { ok: true };
}

/** True for IPv4/IPv6 addresses the worker must never connect to (used after DNS resolution). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.includes(":")) return ipv6Blocked(v);
  return ipv4Blocked(v);
}
