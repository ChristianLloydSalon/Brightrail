import "server-only";
import { Inngest } from "inngest";

/** Shared Inngest client (durable runs, schedules, notification emails, maintenance). */
export const inngest = new Inngest({ id: "flowforge" });
