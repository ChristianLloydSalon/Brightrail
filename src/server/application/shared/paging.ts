import type { Page } from "@/lib/api-error";

/** In-memory page of an already filtered and sorted list; clamps the page into range. */
export function paginate<T>(items: T[], page = 1, pageSize = 10): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  return { items: items.slice((current - 1) * pageSize, current * pageSize), total: items.length, page: current, pageSize, pageCount };
}

/** Page envelope for a list the database already paged. */
export function pageOf<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Database offset for a 1-based page. */
export const offsetOf = (page: number, pageSize: number) => (page - 1) * pageSize;

/** Inclusive day bounds for a `YYYY-MM-DD` filter, in the server's local time (matches the filters' previous behaviour). */
export const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString();
export const dayEnd = (d: string) => new Date(`${d}T23:59:59`).toISOString();
