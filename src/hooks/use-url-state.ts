"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** Keeps list filters in the URL so they survive reloads and can be shared. */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, params.get(k) ?? d])) as T;
  const set = useCallback(
    (patch: Partial<T>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === defaults[k]) next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch) && "page" in defaults) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname, defaults],
  );
  return [state, set] as const;
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
