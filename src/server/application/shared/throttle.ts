import { ApiError } from "@/lib/api-error";
import type { AppConfig, RateLimiter } from "../ports/services";

/**
 * Hourly caps counted in Postgres (0008). If the counter is unavailable the check fails closed in
 * production and open in development, so a fresh install still works.
 */
export class HourlyQuota {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly config: AppConfig,
  ) {}

  /** Counts `times` hits against `key` and throws RATE_LIMITED once the total passes `max`. */
  async consume(key: string, max: number, opts: { times?: number; unavailable: string; exceeded: string; logLabel: string }): Promise<void> {
    let hits = 0;
    for (let i = 0; i < (opts.times ?? 1); i++) {
      const r = await this.limiter.hit(key, 3600);
      if (r.error !== undefined) {
        console.error(`[brightrail] ${opts.logLabel} unavailable — run 0008_security_fixes.sql`, r.error);
        if (this.config.production) throw new ApiError("NOT_CONFIGURED", opts.unavailable);
        return;
      }
      hits = r.count ?? 0;
    }
    if (hits > max) throw new ApiError("RATE_LIMITED", opts.exceeded);
  }
}
