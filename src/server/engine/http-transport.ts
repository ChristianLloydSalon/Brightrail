import "server-only";
import { request } from "node:https";
import type { LookupFunction } from "node:net";

export interface PinnedResponse { status: number; text: string }

/**
 * HTTPS request that connects to an address that was already vetted (DNS-rebinding defence: the name is
 * not resolved a second time), never follows redirects, and stops reading the body after `maxBytes`.
 * TLS still verifies the certificate against the URL's hostname.
 */
export function pinnedRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  pin: { address: string; family: number },
  timeoutMs: number,
  maxBytes: number,
): Promise<PinnedResponse> {
  const u = new URL(url);
  const lookup: LookupFunction = (_host, opts, cb) => {
    if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [pin]);
    else cb(null, pin.address, pin.family);
  };
  return new Promise((resolve, reject) => {
    const req = request(
      { protocol: u.protocol, hostname: u.hostname, port: u.port || 443, path: `${u.pathname}${u.search}`, method: init.method, headers: init.headers, lookup, servername: u.hostname, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size >= maxBytes) return;
          const take = chunk.subarray(0, maxBytes - size);
          chunks.push(take);
          size += take.length;
          if (size >= maxBytes) res.destroy(); // stop downloading; what we have is enough
        });
        const done = () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") });
        res.on("end", done);
        res.on("close", done);
        res.on("error", (e) => (size >= maxBytes ? done() : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
