import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STEPS = [
  { label: "order.created", status: "202", tone: "#ad3209" },
  { label: "Verify payment", status: "ok", tone: "#2f7d4f" },
  { label: "Generate invoice", status: "timeout ×3", tone: "#b42318" },
  { label: "Retry approved", status: "ok", tone: "#2b6cb0" },
];

/** Social share card used by every page that doesn't define its own. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fbfaf9", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <svg width="64" height="64" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="7" fill={SITE.brandColor} />
              <path d="M9 10.5h6.5a3.5 3.5 0 0 1 3.5 3.5v4a3.5 3.5 0 0 0 3.5 3.5H23" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="9" cy="10.5" r="2.6" fill="#fff" />
              <circle cx="23" cy="21.5" r="2.6" fill="#fff" />
              <circle cx="19" cy="16" r="1.6" fill={SITE.brandColor} stroke="#fff" strokeWidth="1.6" />
            </svg>
            <div style={{ fontSize: 44, fontWeight: 700, color: "#1c1917" }}>{SITE.name}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: 60, fontWeight: 700, lineHeight: 1.1, color: "#1c1917", letterSpacing: -1.5 }}>Workflow automation that recovers from failure</div>
            <div style={{ fontSize: 28, lineHeight: 1.4, color: "#57534e" }}>Durable execution, step-by-step run inspection and AI-assisted recovery.</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 28, marginLeft: 56, flex: 1 }}>
          {STEPS.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", height: 72, background: "#fff", border: "2px solid #e7e5e4", borderRadius: 14, overflow: "hidden" }}>
              <div style={{ width: 8, height: "100%", background: s.tone }} />
              <div style={{ display: "flex", flex: 1, justifyContent: "space-between", padding: "0 24px", fontSize: 24, fontFamily: "monospace" }}>
                <span style={{ color: "#1c1917" }}>{s.label}</span>
                <span style={{ color: "#78716c" }}>{s.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
