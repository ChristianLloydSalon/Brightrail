import type { WorkflowDefinition } from "@/lib/domain/types";
import { defaultSchedule } from "@/lib/engine/schedule";
import { TEMPLATES } from "@/lib/templates";

export interface NewWorkflowInput { name: string; description: string; triggerType: "manual" | "webhook" | "schedule"; tags: string[]; templateId?: string }

const TRIGGER_LABEL = { webhook: "Webhook received", schedule: "On a schedule", manual: "Run manually" } as const;

/**
 * Factory for a new workflow's first draft: a template's definition, or a lone trigger node of the
 * chosen kind (schedules start in the workspace's time zone).
 */
export function initialDraft(input: NewWorkflowInput, timezone: string): WorkflowDefinition {
  const template = TEMPLATES.find((t) => t.id === input.templateId);
  if (template) return template.build();
  const triggerType = input.triggerType === "webhook" || input.triggerType === "schedule" ? input.triggerType : "manual";
  return {
    nodes: [{
      id: "n_trigger", kind: "trigger", position: { x: 0, y: 0 },
      label: TRIGGER_LABEL[triggerType],
      config: { triggerType, eventName: "", requiredFields: [], ...(triggerType === "schedule" ? { schedule: defaultSchedule(timezone || "UTC") } : {}) },
    }],
    edges: [],
  };
}
