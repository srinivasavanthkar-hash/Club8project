"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

/** Opens a short-lived signed URL (issued after a server-side permission check) in an inline viewer. */
export function DocLink({ id, label, contentType }: { id: string; label: string; contentType?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [type, setType] = useState(contentType ?? "application/pdf");
  const [err, setErr] = useState<string | null>(null);
  const open = async () => {
    setErr(null);
    try {
      const r = await api.get<{ url: string; content_type: string }>(`/documents/${id}/url`, { inline: true });
      setType(r.content_type);
      setUrl(r.url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.problem.detail : "Cannot open document");
    }
  };
  const download = async () => {
    const r = await api.get<{ url: string }>(`/documents/${id}/url`, { inline: false });
    window.open(r.url, "_blank", "noopener");
  };
  return (
    <>
      <button className="text-xs underline" onClick={open}>{label}</button>
      {err && <span role="alert" className="text-xs text-destructive"> {err}</span>}
      <Dialog open={!!url} onClose={() => setUrl(null)} title={label}>
        {url && (type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="max-h-[65vh] w-full object-contain" />
        ) : (
          <iframe src={url} title={label} className="h-[65vh] w-full" data-testid="doc-preview" />
        ))}
        <button className="mt-2 text-sm underline" onClick={download}>Download</button>
      </Dialog>
    </>
  );
}
