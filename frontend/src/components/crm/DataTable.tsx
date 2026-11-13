"use client";
/* Server-paginated, server-sorted list table (TanStack Table in manual mode) with column visibility, a density
 * toggle, and stacked cards on phones. Column meta:
 *   sortKey  - server sort key (makes the header sortable)
 *   align    - "right" for money / numbers
 *   mobile   - "title" | "subtitle" | "badge" | "field" | "hidden" (card layout below 640px)
 *   hideable - false to keep a column always visible */
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Rows3, Rows4 } from "lucide-react";
import * as React from "react";
import { TableSkeleton } from "@/components/crm/States";
import { Table, Td, Th, THead, Tr, type Density } from "@/components/crm/Table";
import { Button, Checkbox, Empty } from "@/components/ui";
import { cn } from "@/lib/utils";

export type ColumnMeta = { sortKey?: string; align?: "left" | "right"; mobile?: "title" | "subtitle" | "badge" | "field" | "hidden"; hideable?: boolean };

function usePref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = React.useState<T>(initial);
  React.useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setV(s as T); } catch { /* storage unavailable */ }
  }, [key]);
  return [v, (x: T) => { setV(x); try { localStorage.setItem(key, x); } catch { /* ignore */ } }];
}

export function DataTable<T>({
  columns, data, total, page, pageSize, sort, onPage, onSort, onRowClick, caption, loading, emptyMessage, emptyAction, rowTone,
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  sort?: string;
  onPage: (p: number) => void;
  onSort?: (s: string) => void;
  onRowClick?: (row: T) => void;
  caption: string;
  loading?: boolean;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  rowTone?: (row: T) => "danger" | "warning" | "muted" | undefined;
}) {
  const [density, setDensity] = usePref<Density>("ui:density", "comfortable");
  const [hiddenRaw, setHiddenRaw] = usePref<string>(`ui:cols:${caption}`, "");
  const visibility: VisibilityState = React.useMemo(() => Object.fromEntries(hiddenRaw.split(",").filter(Boolean).map((k) => [k, false])), [hiddenRaw]);
  const table = useReactTable({
    data, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true,
    state: { columnVisibility: visibility },
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [colsOpen, setColsOpen] = React.useState(false);
  const meta = (c: { columnDef: ColumnDef<T, unknown> }) => (c.columnDef.meta ?? {}) as ColumnMeta;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="hidden items-center justify-end gap-1 sm:flex">
        <div className="relative">
          <Button variant="ghost" size="sm" aria-expanded={colsOpen} aria-haspopup="true" onClick={() => setColsOpen(!colsOpen)}>
            <Columns3 aria-hidden />Columns
          </Button>
          {colsOpen && (
            <div
              className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-surface-raised p-2 shadow-popover"
              onKeyDown={(e) => e.key === "Escape" && setColsOpen(false)}
            >
              <p className="px-1 pb-1 text-xs font-medium text-fg-subtle">Show columns</p>
              {table.getAllLeafColumns().filter((c) => meta(c).hideable !== false).map((c) => (
                <Checkbox
                  key={c.id}
                  className="w-full rounded-md px-1 hover:bg-surface-sunken"
                  label={String(c.columnDef.header)}
                  checked={c.getIsVisible()}
                  onChange={(e) => {
                    const hidden = new Set(hiddenRaw.split(",").filter(Boolean));
                    if (e.target.checked) hidden.delete(c.id); else hidden.add(c.id);
                    setHiddenRaw([...hidden].join(","));
                  }}
                />
              ))}
              <Button variant="link" size="sm" className="mt-1 px-1" onClick={() => setColsOpen(false)}>Done</Button>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={density === "compact"}
          onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
          title="Toggle compact rows"
        >
          {density === "compact" ? <Rows4 aria-hidden /> : <Rows3 aria-hidden />}Compact
        </Button>
      </div>

      {/* Desktop / tablet table */}
      <div className="hidden sm:block">
        <Table caption={caption} density={density} maxHeight>
          <THead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const m = meta(h.column);
                  const key = m.sortKey;
                  const dir = sort === key ? "ascending" : sort === `-${key}` ? "descending" : undefined;
                  const Icon = dir === "ascending" ? ArrowUp : dir === "descending" ? ArrowDown : ArrowUpDown;
                  return (
                    <Th key={h.id} aria-sort={key ? dir ?? "none" : undefined} align={m.align}>
                      {key && onSort ? (
                        <button
                          type="button"
                          className={cn("-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-fg", dir && "text-fg", m.align === "right" && "flex-row-reverse")}
                          onClick={() => onSort(sort === key ? `-${key}` : key)}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <Icon aria-hidden className={cn("size-3.5", !dir && "text-fg-subtle/70")} />
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </Th>
                  );
                })}
              </tr>
            ))}
          </THead>
          <tbody>
            {!loading && table.getRowModel().rows.map((row) => (
              <Tr
                key={row.id}
                tone={rowTone?.(row.original)}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={(e) => e.key === "Enter" && onRowClick?.(row.original)}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <Td key={cell.id} align={meta(cell.column).align}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
        {loading && <TableSkeleton rows={6} cols={Math.min(columns.length, 6)} />}
      </div>

      {/* Phone: stacked cards (after the table in DOM order) */}
      <ul className="flex flex-col gap-2 sm:hidden" aria-label={caption}>
        {loading && <li><TableSkeleton rows={4} cols={2} /></li>}
        {!loading && table.getRowModel().rows.map((row) => {
          const cells = row.getAllCells();
          const pick = (slot: ColumnMeta["mobile"]) => cells.filter((c) => meta(c.column).mobile === slot);
          const fields = pick("field");
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {pick("title").map((c) => <div key={c.id} className="font-medium text-fg">{flexRender(c.column.columnDef.cell, c.getContext())}</div>)}
                  {pick("subtitle").map((c) => <div key={c.id} className="truncate text-sm text-fg-muted">{flexRender(c.column.columnDef.cell, c.getContext())}</div>)}
                </div>
                {pick("badge").map((c) => <div key={c.id} className="shrink-0">{flexRender(c.column.columnDef.cell, c.getContext())}</div>)}
              </div>
              {fields.length > 0 && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {fields.map((c) => (
                    <div key={c.id} className="min-w-0">
                      <dt className="text-xs text-fg-subtle">{String(c.column.columnDef.header)}</dt>
                      <dd className="truncate text-sm text-fg">{flexRender(c.column.columnDef.cell, c.getContext())}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          const tone = rowTone?.(row.original);
          return (
            <li key={row.id}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row.original)}
                  className={cn("block w-full rounded-lg border border-border bg-surface p-3 text-left active:bg-primary-subtle/50", tone === "danger" && "border-danger/40 bg-danger-subtle/50", tone === "warning" && "border-warning/40 bg-warning-subtle/40")}
                >
                  {body}
                </button>
              ) : <div className="rounded-lg border border-border bg-surface p-3">{body}</div>}
            </li>
          );
        })}
      </ul>

      {!loading && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <Empty action={emptyAction}>{emptyMessage ?? "No records match these filters."}</Empty>
        </div>
      )}

      <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-fg-muted">
          {total === 0 ? "No records" : <>Showing <strong className="font-medium text-fg">{from}–{to}</strong> of <strong className="font-medium text-fg">{total}</strong></>}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft aria-hidden />Previous</Button>
          <span className="tabular-nums text-fg-muted">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<ChevronRight aria-hidden /></Button>
        </div>
      </nav>
    </div>
  );
}
