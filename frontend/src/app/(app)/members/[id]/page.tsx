"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import { CorrespondenceTab } from "@/components/member/CorrespondenceTab";
import { EntitlementTab } from "@/components/member/EntitlementTab";
import { FinanceTab } from "@/components/member/FinanceTab";
import { HistoryTab } from "@/components/member/HistoryTab";
import { ProfileTab } from "@/components/member/ProfileTab";
import { ReservationsTab } from "@/components/member/ReservationsTab";
import { useCan } from "@/components/providers";
import { Badge, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import type { Member } from "@/lib/types";

const TABS = [
  { id: "profile", label: "Profile", perm: "member.view" },
  { id: "finance", label: "Finance", perm: "finance.view" },
  { id: "reservations", label: "Reservations", perm: "reservation.view" },
  { id: "entitlement", label: "Entitlement", perm: "entitlement.view" },
  { id: "correspondence", label: "Correspondence & Documents", perm: "correspondence.view" },
  { id: "history", label: "History", perm: "member.view" },
];

function MemberRecord({ id }: { id: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const can = useCan();
  const tab = sp.get("tab") ?? "profile";
  const { data: m, error } = useQuery({ queryKey: ["member", id], queryFn: () => api.get<Member>(`/members/${id}`) });
  if (error) return <p role="alert">Could not load member.</p>;
  if (!m) return <p>Loading…</p>;
  const tabs = TABS.filter((t) => can(t.perm));
  const a1 = m.applicants.find((a) => a.position === 1);
  const a2 = m.applicants.find((a) => a.position === 2);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{m.membership_number}</h1>
        <span>{a1?.full_name}{a2 ? ` & ${a2.full_name}` : ""}</span>
        <Badge>{m.status}</Badge>
        <span className="text-xs text-muted-foreground">Member ID {m.id}</span>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={(t) => router.replace(`/members/${id}?tab=${t}`, { scroll: false })} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "profile" && <ProfileTab member={m} />}
        {tab === "finance" && <FinanceTab member={m} />}
        {tab === "reservations" && <ReservationsTab member={m} />}
        {tab === "entitlement" && <EntitlementTab member={m} />}
        {tab === "correspondence" && <CorrespondenceTab member={m} />}
        {tab === "history" && <HistoryTab member={m} />}
      </div>
    </div>
  );
}

export default function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <MemberRecord id={id} />
    </Suspense>
  );
}
