"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use } from "react";
import { PageHeader } from "@/components/crm/Display";
import { PageSkeleton } from "@/components/crm/States";
import { MemberForm, toPayload } from "@/components/MemberForm";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";

type Prefill = {
  applicant1: { full_name: string; mobile: string; email: string | null };
  email: string | null;
  address: { city: string | null };
  relationship_manager_id: string | null;
};

export default function ConvertLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const prefill = useQuery({ queryKey: ["prefill", id], queryFn: () => api.get<Prefill>(`/leads/${id}/conversion-prefill`) });
  if (!prefill.data) return <PageSkeleton variant="record" />;
  const p = prefill.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Convert lead to member" description="Pre-filled from the lead. The lead is kept and linked to the new member in one transaction." />
      <MemberForm
        submitLabel="Create member & convert lead"
        defaults={{
          applicant1: { full_name: p.applicant1.full_name, mobile: p.applicant1.mobile, email: p.applicant1.email ?? "", dob: "", kyc: [{ id_type: "PAN", value: "" }] },
          email: p.email ?? "",
          address: { line1: "", city: p.address.city ?? "", country: "India" },
          relationship_manager_id: p.relationship_manager_id ?? "",
        }}
        onSubmit={async (v) => {
          const m = await api.post<Member>(`/leads/${id}/convert`, toPayload(v, id));
          router.push(`/members/${m.id}`);
        }}
      />
    </div>
  );
}
