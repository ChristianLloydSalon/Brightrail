/**
 * Full page load. Used only right after sign-in, sign-out, two-factor and account changes, so the
 * server and every cached query start fresh from the new session cookie. Everything else uses the
 * Next.js router.
 */
export function reloadTo(path: string) {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
  window.location.assign(safe);
}
