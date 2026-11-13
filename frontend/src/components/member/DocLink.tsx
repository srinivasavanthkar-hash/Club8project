"use client";
import { Download, Eye } from "lucide-react";
import { useState } from "react";
import { Button, Drawer } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

/** Opens a short-lived signed URL (issued after a server-side permission check) in an inline preview drawer. */
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
      <Button variant="ghost" size="sm" onClick={open}><Eye aria-hidden />{label}</Button>
      {err && <span role="alert" className="text-xs text-danger"> {err}</span>}
      <Drawer
        open={!!url}
        onClose={() => setUrl(null)}
        title={label}
        footer={<Button variant="outline" onClick={download}><Download aria-hidden />Download</Button>}
      >
        {url && (type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="mx-auto max-h-full w-full rounded-md object-contain" />
        ) : (
          <iframe src={url} title={label} className="h-full min-h-[70vh] w-full rounded-md border border-border" data-testid="doc-preview" />
        ))}
      </Drawer>
    </>
  );
}
