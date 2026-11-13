"use client";
import { Bookmark, BookmarkPlus, Check, X } from "lucide-react";
import * as React from "react";
import { Button, Input } from "./ui";

/** Saved-search chips (named filter sets kept per browser) plus an inline "Save search" form. */
export function SavedSearches<F>({ saved, onApply, onSave }: { saved: Record<string, F>; onApply: (f: F) => void; onSave: (name: string) => void }) {
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState("");
  const names = Object.keys(saved);
  const commit = () => {
    if (name.trim()) onSave(name.trim());
    setName("");
    setNaming(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Saved searches" role="group">
      {names.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onApply(saved[n] as F)}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-surface px-2.5 text-sm text-fg-muted hover:border-primary/40 hover:bg-primary-subtle hover:text-primary touch:h-11"
        >
          <Bookmark aria-hidden className="size-3.5" />{n}
        </button>
      ))}
      {naming ? (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); commit(); }}>
          <Input autoFocus aria-label="Name this search" placeholder="Name this search" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-44"
            onKeyDown={(e) => e.key === "Escape" && setNaming(false)} />
          <Button type="submit" size="icon" variant="ghost" aria-label="Save this search" disabled={!name.trim()}><Check aria-hidden /></Button>
          <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => setNaming(false)}><X aria-hidden /></Button>
        </form>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setNaming(true)}><BookmarkPlus aria-hidden />Save search</Button>
      )}
    </div>
  );
}
