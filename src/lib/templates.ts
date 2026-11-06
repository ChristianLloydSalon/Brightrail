import type { EdgeHandle, NodeConfigMap, NodeKind, WorkflowDefinition, WorkflowNode } from "@/lib/domain/types";

type NodeSpec = { [K in NodeKind]: [K, string, string, NodeConfigMap[K], number, number] }[NodeKind];

function graph(nodes: NodeSpec[], edges: Array<[string, string, EdgeHandle?]>): WorkflowDefinition {
  return {
    nodes: nodes.map(([kind, id, label, config, col, lane]) => ({ id, kind, label, config, position: { x: col * 300, y: lane * 150 } }) as WorkflowNode),
    edges: edges.map(([source, target, handle = "default"]) => ({ id: `e_${source}_${target}_${handle}`, source, target, sourceHandle: handle })),
  };
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  /** One plain-language sentence for the onboarding card. */
  pitch: string;
  steps: string[];
  needs: string[];
  trigger: "manual" | "webhook";
  build: () => WorkflowDefinition;
}

/** Starter workflows offered during onboarding. Connections are left for the user to pick. */
export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "form-to-slack",
    name: "Tell my team in Slack about new form submissions",
    pitch: "When your website form sends an event, FlowForge posts a message to a Slack channel.",
    steps: ["A form submission arrives", "Post it to Slack"],
    needs: ["A Slack incoming-webhook URL"],
    trigger: "webhook",
    build: () =>
      graph(
        [
          ["trigger", "n_trigger", "Form submitted", { triggerType: "webhook", eventName: "form.submitted", requiredFields: ["name", "message"] }, 0, 0],
          ["action", "n_slack", "Post to Slack", { integrationId: "int_slack", actionKey: "slack.post_message", inputMapping: [{ field: "text", source: "New message from {{name}}: {{message}}" }], timeoutSec: 10, maxAttempts: 2 }, 1, 0],
        ],
        [["n_trigger", "n_slack"]],
      ),
  },
  {
    id: "welcome-email",
    name: "Send a welcome email to new sign-ups",
    pitch: "When someone signs up in your product, wait a few minutes, then email them a welcome note.",
    steps: ["A sign-up event arrives", "Wait 5 minutes", "Send the welcome email"],
    needs: ["A free Resend account and API key"],
    trigger: "webhook",
    build: () =>
      graph(
        [
          ["trigger", "n_trigger", "User signed up", { triggerType: "webhook", eventName: "user.signed_up", requiredFields: ["email", "name"] }, 0, 0],
          ["delay", "n_wait", "Wait 5 minutes", { amount: 5, unit: "minutes" }, 1, 0],
          ["action", "n_email", "Send welcome email", { integrationId: "int_resend", actionKey: "email.send", inputMapping: [{ field: "to", source: "email" }, { field: "subject", source: "Welcome aboard, {{name}}!" }, { field: "text", source: "Hi {{name}}, thanks for signing up. Reply to this email if you need anything." }], timeoutSec: 15, maxAttempts: 3 }, 2, 0],
        ],
        [["n_trigger", "n_wait"], ["n_wait", "n_email"]],
      ),
  },
  {
    id: "api-to-discord",
    name: "Check an API and post the result to Discord",
    pitch: "Run it whenever you like: FlowForge calls a public API and posts a summary to Discord.",
    steps: ["You click Run", "Call the GitHub API", "Post the star count to Discord"],
    needs: ["A Discord webhook URL"],
    trigger: "manual",
    build: () =>
      graph(
        [
          ["trigger", "n_trigger", "Run manually", { triggerType: "manual", requiredFields: [] }, 0, 0],
          ["http", "n_api", "Get repository stats", { method: "GET", url: "https://api.github.com/repos/vercel/next.js", headers: [{ key: "Accept", value: "application/json" }], timeoutSec: 15, maxAttempts: 3, useIdempotencyKey: false }, 1, 0],
          ["condition", "n_ok", "Request succeeded?", { field: "status", operator: "equals", value: "200" }, 2, 0],
          ["action", "n_discord", "Post to Discord", { integrationId: "int_discord", actionKey: "discord.post_message", inputMapping: [{ field: "text", source: "Next.js has {{body.stargazers_count}} stars on GitHub." }], timeoutSec: 10, maxAttempts: 2 }, 3, -1],
        ],
        [["n_trigger", "n_api"], ["n_api", "n_ok"], ["n_ok", "n_discord", "true"]],
      ),
  },
  {
    id: "blank",
    name: "Start from scratch",
    pitch: "An empty workflow with a manual trigger. Add steps in the visual editor.",
    steps: ["You click Run", "…your steps"],
    needs: [],
    trigger: "manual",
    build: () => graph([["trigger", "n_trigger", "Run manually", { triggerType: "manual", requiredFields: [] }, 0, 0]], []),
  },
];
