"use client";
import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/crm/Display";
import { buttonClasses, Card, Field, Input, Select } from "@/components/ui";
import { qs } from "@/lib/api";
import { humanize } from "@/lib/format";

const EXPORTS = [
  { id: "leads", label: "Leads", filters: ["status", "date_from", "date_to"] },
  { id: "members", label: "Members", filters: ["status", "q"] },
  { id: "payments", label: "Payments", filters: ["payment_type", "date_from", "date_to"] },
  { id: "reservations", label: "Reservations", filters: ["status", "check_in_from", "check_in_to"] },
  { id: "entitlement", label: "Entitlement balances", filters: ["status"] },
  { id: "activity-log", label: "Activity log", filters: ["action", "date_from", "date_to"] },
];

export default function ExportsPage() {
  const [fmt, setFmt] = useState("xlsx");
  const [f, setF] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Exports"
        description="Every export is recorded in the activity log with its filters."
        actions={
          <Field label="Format" htmlFor="xf" className="w-40"><Select id="xf" value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="xlsx">Excel</option><option value="csv">CSV</option></Select></Field>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {EXPORTS.map((x) => (
          <Card key={x.id} title={<span className="flex items-center gap-2"><FileSpreadsheet aria-hidden className="size-4 text-fg-subtle" />{x.label}</span>}>
            <div className="flex flex-col gap-3">
              {x.filters.map((k) => (
                <Field key={k} label={humanize(k).replace(/^Q$/, "Search")} htmlFor={`${x.id}-${k}`}>
                  <Input id={`${x.id}-${k}`} type={k.includes("date") || k.includes("from") || k.includes("_to") ? "date" : "text"}
                    value={f[`${x.id}.${k}`] ?? ""} onChange={(e) => setF({ ...f, [`${x.id}.${k}`]: e.target.value })} />
                </Field>
              ))}
              <a className={buttonClasses({ className: "mt-1" })}
                href={`/api/v1/exports/${x.id}?${qs({ fmt, ...Object.fromEntries(x.filters.map((k) => [k, f[`${x.id}.${k}`]])) })}`}>
                <Download aria-hidden />Download {fmt === "xlsx" ? "Excel" : "CSV"}
              </a>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
