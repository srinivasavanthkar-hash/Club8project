"use client";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/crm/Display";
import { MemberForm, toPayload } from "@/components/MemberForm";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";

export default function NewMemberPage() {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="New membership application" description="Key in the paper Membership Application Form section by section, top to bottom." />
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
