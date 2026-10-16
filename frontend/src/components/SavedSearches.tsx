"use client";
import { Button, Select } from "./ui";

export function SavedSearches<F>({ saved, onApply, onSave }: { saved: Record<string, F>; onApply: (f: F) => void; onSave: (name: string) => void }) {
  return (
    <div className="flex items-end gap-2">
      <Select aria-label="Saved searches" defaultValue="" onChange={(e) => e.target.value && onApply(saved[e.target.value] as F)} className="w-40">
        <option value="">Saved searches…</option>
        {Object.keys(saved).map((n) => <option key={n}>{n}</option>)}
      </Select>
      <Button type="button" variant="outline" size="sm" onClick={() => { const n = prompt("Name this search"); if (n) onSave(n); }}>Save search</Button>
    </div>
  );
}
