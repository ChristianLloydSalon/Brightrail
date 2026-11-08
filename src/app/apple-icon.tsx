import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** PNG version of public/icon.svg for iOS home screens, which ignore SVG icons. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: SITE.brandColor }}>
        <svg width="180" height="180" viewBox="0 0 32 32">
          <path d="M9 10.5h6.5a3.5 3.5 0 0 1 3.5 3.5v4a3.5 3.5 0 0 0 3.5 3.5H23" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="9" cy="10.5" r="2.6" fill="#fff" />
          <circle cx="23" cy="21.5" r="2.6" fill="#fff" />
          <circle cx="19" cy="16" r="1.6" fill={SITE.brandColor} stroke="#fff" strokeWidth="1.6" />
        </svg>
      </div>
    ),
    size,
  );
}
