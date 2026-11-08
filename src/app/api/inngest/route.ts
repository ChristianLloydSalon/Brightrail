import { serve } from "inngest/next";
import { inngest } from "@/server/infrastructure/inngest/client";
import { allFunctions } from "@/server/infrastructure/inngest/functions";

// Inngest calls this endpoint to execute workflow steps. Signed with INNGEST_SIGNING_KEY in production.
const handlers = serve({ client: inngest, functions: allFunctions });

/**
 * INNGEST_DEV disables request-signature checks. This endpoint is public, so in production a stray
 * INNGEST_DEV (or a missing signing key) would let anyone invoke workflow functions: refuse instead.
 */
const unsafe = process.env.NODE_ENV === "production" && (!!process.env.INNGEST_DEV || !process.env.INNGEST_SIGNING_KEY);
const refuse = () => Response.json({ code: "NOT_CONFIGURED", message: "Inngest signing is not configured for production (set INNGEST_SIGNING_KEY and unset INNGEST_DEV)." }, { status: 503 });

/**
 * In production, turn away unsigned or oversized calls before the SDK parses anything. inngest@4 bundles
 * zod 3, which has a memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5) with no fixed zod 3 release, so
 * unauthenticated bodies shouldn't reach its validators at all. The SDK still verifies the signature itself.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
function guarded(handler: (req: Request, ctx: unknown) => Promise<Response>) {
  return async (req: Request, ctx: unknown) => {
    if (process.env.NODE_ENV === "production") {
      if (!req.headers.get("x-inngest-signature")) return Response.json({ code: "UNAUTHENTICATED", message: "Missing Inngest signature." }, { status: 401 });
      if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    return handler(req, ctx);
  };
}

export const GET = unsafe ? refuse : handlers.GET;
export const POST = unsafe ? refuse : guarded(handlers.POST as (req: Request, ctx: unknown) => Promise<Response>);
// PUT (app sync/registration) may come unsigned from deploy hooks and only makes the SDK register itself.
export const PUT = unsafe ? refuse : handlers.PUT;
export const maxDuration = 60;
