"use client";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Button, Empty } from "./ui";

/** Server-paginated, server-sorted table (TanStack Table in manual mode). */
export function DataTable<T>({
  columns, data, total, page, pageSize, sort, onPage, onSort, onRowClick, caption,
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
}) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), manualPagination: true, manualSorting: true });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="w-full">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const key = (h.column.columnDef.meta as { sortKey?: string } | undefined)?.sortKey;
                  const dir = sort === key ? "ascending" : sort === `-${key}` ? "descending" : undefined;
                  return (
                    <th key={h.id} scope="col" aria-sort={dir} className="px-3 py-2 text-left font-medium">
                      {key && onSort ? (
                        <button className="underline-offset-2 hover:underline" onClick={() => onSort(sort === key ? `-${key}` : key)}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "ascending" ? " ▲" : dir === "descending" ? " ▼" : ""}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={onRowClick ? "cursor-pointer border-t border-border hover:bg-muted/60" : "border-t border-border"}
                onClick={() => onRowClick?.(row.original)}
                onKeyDown={(e) => e.key === "Enter" && onRowClick?.(row.original)}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <Empty>No records match these filters.</Empty>}
      </div>
      <nav aria-label="Pagination" className="mt-2 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{total} record(s)</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        </div>
      </nav>
    </div>
  );
}
