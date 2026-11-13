"use client";
import { useEffect, useRef } from "react";

/** Ctrl/⌘+S saves the current form (the browser's "save page" is prevented). UI layer only. */
export function useSaveShortcut(onSave: () => void, enabled = true) {
  const cb = useRef(onSave);
  cb.current = onSave;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        cb.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
