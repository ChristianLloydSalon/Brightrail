/**
 * Full page load. Used only right after sign-in, sign-out, two-factor and account changes, so the
 * server and every cached query start fresh from the new session cookie. Everything else uses the
 * Next.js router.
 */
export function reloadTo(path: string) {
  window.location.assign(safeLocalPath(path));
}

/**
 * Returns `next` only if it resolves to a path on this site, otherwise `fallback`.
 * A prefix check alone isn't enough: URL parsers treat "\" like "/" and drop tabs/newlines, so
 * "/\evil.example" or "/\t/evil.example" would become "//evil.example", i.e. another site.
 */
export function safeLocalPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = "https://local.invalid";
    const u = new URL(next, base);
    return u.origin === base ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}
