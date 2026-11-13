"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import { MemberHeader } from "@/components/crm/MemberHeader";
import { ErrorState, PageSkeleton } from "@/components/crm/States";
import { CorrespondenceTab } from "@/components/member/CorrespondenceTab";
import { EntitlementTab } from "@/components/member/EntitlementTab";
import { FinanceTab } from "@/components/member/FinanceTab";
import { HistoryTab } from "@/components/member/HistoryTab";
import { ProfileTab } from "@/components/member/ProfileTab";
import { ReservationsTab } from "@/components/member/ReservationsTab";
import { useCan } from "@/components/providers";
import { Tabs } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import type { Member, Reservation } from "@/lib/types";

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
  const { data: m, error, refetch } = useQuery({ queryKey: ["member", id], queryFn: () => api.get<Member>(`/members/${id}`) });
  // Same query as the Reservations tab: gives the tab its count.
  const reservations = useQuery({
    queryKey: ["reservations", id],
    queryFn: () => api.get<Page<Reservation>>("/reservations", { member_id: id, page_size: 100 }),
    enabled: can("reservation.view"),
  });
  const docs = useQuery({ queryKey: ["docs", id], queryFn: () => api.get<unknown[]>(`/members/${id}/documents`), enabled: can("correspondence.view") });
  if (error) return <ErrorState message="This member could not be loaded." onRetry={() => refetch()} />;
  if (!m) return <PageSkeleton variant="record" />;
  const counts: Record<string, number | undefined> = { reservations: reservations.data?.total, correspondence: docs.data?.length };
  const tabs = TABS.filter((t) => can(t.perm)).map((t) => ({ ...t, count: counts[t.id] }));
  return (
    <div className="flex flex-col gap-4">
      <MemberHeader m={m} />
      <Tabs label="Member sections" tabs={tabs} active={tab} onChange={(t) => router.replace(`/members/${id}?tab=${t}`, { scroll: false })} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="outline-none">
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
    <Suspense fallback={<PageSkeleton variant="record" />}>
      <MemberRecord id={id} />
    </Suspense>
  );
}
