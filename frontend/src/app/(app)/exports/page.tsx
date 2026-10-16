"use client";
import { useState } from "react";
import { Card, Field, Input, Select } from "@/components/ui";
import { qs } from "@/lib/api";

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
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Exports</h1>
      <p className="text-sm text-muted-foreground">Every export is recorded in the activity log with its filters.</p>
      <Field label="Format" htmlFor="xf" className="max-w-40"><Select id="xf" value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="xlsx">Excel</option><option value="csv">CSV</option></Select></Field>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {EXPORTS.map((x) => (
          <Card key={x.id} title={x.label}>
            <div className="grid gap-2">
              {x.filters.map((k) => (
                <Field key={k} label={k.replaceAll("_", " ")} htmlFor={`${x.id}-${k}`}>
                  <Input id={`${x.id}-${k}`} type={k.includes("date") || k.includes("from") || k.includes("_to") ? "date" : "text"}
                    value={f[`${x.id}.${k}`] ?? ""} onChange={(e) => setF({ ...f, [`${x.id}.${k}`]: e.target.value })} />
                </Field>
              ))}
              <a className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm text-primary-foreground"
                href={`/api/v1/exports/${x.id}?${qs({ fmt, ...Object.fromEntries(x.filters.map((k) => [k, f[`${x.id}.${k}`]])) })}`}>
                Download
              </a>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
