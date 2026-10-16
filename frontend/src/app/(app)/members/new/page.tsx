"use client";
import { useRouter } from "next/navigation";
import { MemberForm, toPayload } from "@/components/MemberForm";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";

export default function NewMemberPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New membership application</h1>
      <MemberForm
        submitLabel="Save application"
        onSubmit={async (v) => {
          const m = await api.post<Member>("/members", toPayload(v));
          router.push(`/members/${m.id}`);
        }}
      />
    </div>
  );
}
