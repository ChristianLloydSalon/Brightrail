"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { ErrorState, Skeleton } from "./feedback";
import { Select } from "./select";

export interface Column<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
  /** Hide this column below a breakpoint (the mobile card shows the essentials). */
  hideBelow?: "lg" | "xl";
  align?: "left" | "right";
}

export interface SortState<K extends string = string> {
  key: K;
  dir: "asc" | "desc";
}

interface DataTableProps<T, K extends string> {
  caption: string;
  captionVisible?: boolean;
  columns: Column<T>[];
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: React.ReactNode;
  sort?: SortState<K>;
  onSortChange?: (s: SortState<K>) => void;
  /** Card renderer used below the md breakpoint instead of a horizontally scrolling table. */
  mobileCard?: (row: T) => React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
  footer?: React.ReactNode;
  skeletonRows?: number;
}

/**
 * Accessible data table: native table semantics, <caption>, scope="col", aria-sort on sortable
 * headers (sort buttons are real buttons), and explicit loading / empty / error states.
 */
export function DataTable<T, K extends string = string>({
  caption, captionVisible, columns, rows, getRowId, isLoading, isFetching, error, onRetry, empty, sort, onSortChange, mobileCard, rowClassName, footer, skeletonRows = 6,
}: DataTableProps<T, K>) {
  const hideCls = (c: Column<T>) => (c.hideBelow === "lg" ? "hidden lg:table-cell" : c.hideBelow === "xl" ? "hidden xl:table-cell" : "");

  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} title={`Couldn't load ${caption.toLowerCase()}`} />;

  const showEmpty = !isLoading && rows && rows.length === 0;
  if (showEmpty)
    return (
      <div>
        <h3 className="sr-only">{caption}</h3>
        {empty}
        {footer}
      </div>
    );
  return (
    <div className={cn("relative", isFetching && !isLoading && "opacity-80 transition-opacity")} aria-busy={isLoading || isFetching || undefined}>
      {mobileCard && (
        <div className="md:hidden">
          <h3 className={cn(captionVisible ? "px-4 pt-3 text-sm font-medium" : "sr-only")}>{caption}</h3>
          {isLoading ? (
            <ul className="divide-y divide-border" aria-label={`Loading ${caption}`}>
              {Array.from({ length: 4 }, (_, i) => (
                <li key={i} className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="divide-y divide-border" aria-label={caption}>
              {rows?.map((r) => (
                <li key={getRowId(r)} className="p-4">
                  {mobileCard(r)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className={cn(mobileCard && "hidden md:block")}>
        <div className="overflow-x-auto" tabIndex={-1}>
          <table className="w-full border-collapse text-left text-base">
            <caption className={cn(captionVisible ? "px-4 py-2 text-left text-sm font-medium text-fg-muted" : "sr-only")}>{caption}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-sunken">
                {columns.map((c) => {
                  const active = sort?.key === c.id;
                  const ariaSort = c.sortable ? (active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined;
                  return (
                    <th key={c.id} scope="col" aria-sort={ariaSort} className={cn("h-10 px-4 text-sm font-medium whitespace-nowrap text-fg-muted", c.align === "right" && "text-right", hideCls(c), c.headerClassName)}>
                      {c.sortable && onSortChange ? (
                        <button
                          type="button"
                          className={cn("-mx-1.5 inline-flex items-center gap-1 rounded-xs px-1.5 py-1 hover:text-fg", active && "text-fg")}
                          onClick={() => onSortChange({ key: c.id as K, dir: active && sort!.dir === "desc" ? "asc" : "desc" })}
                        >
                          {c.header}
                          {active ? sort!.dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUpDown className="size-3.5 opacity-60" aria-hidden />}
                          <span className="sr-only">{active ? `, sorted ${sort!.dir === "asc" ? "ascending" : "descending"}. Activate to sort ${sort!.dir === "desc" ? "ascending" : "descending"}` : ", activate to sort"}</span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {columns.map((c) => (
                      <td key={c.id} className={cn("h-13 px-4", hideCls(c))}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!isLoading &&
                rows?.map((r) => (
                  <tr key={getRowId(r)} className={cn("border-b border-border transition-colors last:border-0 hover:bg-surface-hover/60", rowClassName?.(r))}>
                    {columns.map((c) => (
                      <td key={c.id} className={cn("h-13 px-4 py-2 align-middle", c.align === "right" && "text-right", hideCls(c), c.className)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {isLoading && <span className="sr-only" role="status">Loading {caption}…</span>}
      </div>
      {footer}
    </div>
  );
}

interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  pageSizes?: number[];
  label?: string;
}

export function Pagination({ page, pageCount, total, pageSize, onPageChange, onPageSizeChange, pageSizes = [10, 20, 50], label = "Pagination" }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages = React.useMemo(() => {
    const set = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
    return [...set].sort((a, b) => a - b);
  }, [page, pageCount]);
  return (
    <nav aria-label={label} className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-fg-muted tabular" aria-live="polite">
        {total === 0 ? "No results" : `Showing ${from}–${to} of ${total.toLocaleString()}`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-fg-muted" id="page-size-label">Rows</span>
            <Select
              size="sm"
              aria-label="Rows per page"
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
              options={pageSizes.map((s) => ({ value: String(s), label: String(s) }))}
              className="w-18"
            />
          </div>
        )}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
            <ChevronLeft aria-hidden />
          </Button>
          {pages.map((p, i) => (
            <React.Fragment key={p}>
              {i > 0 && p - pages[i - 1]! > 1 && <span className="px-1 text-fg-subtle" aria-hidden>…</span>}
              <Button variant={p === page ? "secondary" : "ghost"} size="icon-sm" onClick={() => onPageChange(p)} aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined} className="tabular">
                {p}
              </Button>
            </React.Fragment>
          ))}
          <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}
