/** Plans set a workspace's limits. There's no payment step: owners switch plans in Settings → Plan & usage. */
export type PlanId = "free" | "team";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  quotas: { executionsPerMonth: number; members: number; connections: number };
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "For trying FlowForge and small personal automations.",
    quotas: { executionsPerMonth: 1000, members: 5, connections: 10 },
    features: ["1,000 runs per month", "Up to 5 members", "10 connections", "All connectors, schedules and the AI assistant", "30–90 days of run history"],
  },
  team: {
    id: "team",
    name: "Team",
    tagline: "For teams running automations every day.",
    quotas: { executionsPerMonth: 25000, members: 50, connections: 100 },
    features: ["25,000 runs per month", "Up to 50 members", "100 connections", "Everything in Free", "Room to grow before you hit your hosting provider's free tiers"],
  },
};

export const planName = (id: string) => PLANS[id as PlanId]?.name ?? "Custom";
