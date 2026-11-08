"use client";

import * as React from "react";

type Announce = (message: string, politeness?: "polite" | "assertive") => void;
const Ctx = React.createContext<Announce>(() => {});

/** Global live regions for status announcements (WCAG 4.1.3). */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = React.useState("");
  const [assertive, setAssertive] = React.useState("");
  const announce = React.useCallback<Announce>((message, politeness = "polite") => {
    const set = politeness === "assertive" ? setAssertive : setPolite;
    set("");
    window.setTimeout(() => set(message), 60);
  }, []);
  return (
    <Ctx.Provider value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive}</div>
    </Ctx.Provider>
  );
}

export const useAnnounce = () => React.useContext(Ctx);
