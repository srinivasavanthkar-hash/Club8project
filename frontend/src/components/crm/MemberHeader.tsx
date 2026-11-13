"use client";
/* Sticky member header: who, which membership, and the four facts staff need at a glance. Each fact is fetched only
 * when the user may see it (same endpoints and query keys as the tabs, so data is shared, not re-fetched). */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronDown, MoonStar, Receipt, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BrandChip } from "@/components/crm/Brand";
import { CategoryChip, Chip, CopyButton, Money, Mono, SeasonChip, StatTile, usePageTitle } from "@/components/crm/Display";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { useCan, useMaster } from "@/components/providers";
import { buttonClasses } from "@/components/ui";
import { api } from "@/lib/api";
import { daysFromToday, formatDate, formatNights, formatRelativeDays, todayIso } from "@/lib/format";
import type { Member, YearView } from "@/lib/types";
import { cn } from "@/lib/utils";

type Brief = { id: string; reservation_number: string; check_in: string; check_out: string; status: string; entitlement_nights: string };
type Summary = { balance: string; balance_display: string; currency: string };
type AsfYear = { membership_year: number; status: string };
type Notice = { id: string; issued_on: string; deadline: string; amount_overdue: string; status: string };

export function MemberHeader({ m }: { m: Member }) {
  const can = useCan();
  const year = Number(todayIso().slice(0, 4));
  const cats = useMaster("resort-categories");
  const seasons = useMaster("seasons");
  const units = useMaster("unit-types");
  const ent = useQuery({
    queryKey: ["entitlement", m.id],
    queryFn: () => api.get<{ years: YearView[]; past: Brief[]; upcoming: Brief[] }>(`/members/${m.id}/entitlement`),
    enabled: can("entitlement.view"),
  });
  const fin = useQuery({ queryKey: ["fin-summary", m.id], queryFn: () => api.get<Summary>(`/members/${m.id}/finance-summary`), enabled: can("finance.view") });
  const asf = useQuery({ queryKey: ["asf", m.id], queryFn: () => api.get<AsfYear[]>(`/members/${m.id}/asf`), enabled: can("finance.view") });
  const notices = useQuery({
    queryKey: ["notices", m.id],
    queryFn: () => api.get<Notice[]>(`/members/${m.id}/default-notices`),
    enabled: can("finance.view") && m.status === "DEFAULT_NOTICE",
  });
  usePageTitle(m.membership_number);
  const [more, setMore] = React.useState(false);
  const [stuck, setStuck] = React.useState(false);
  const sentinel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e!.isIntersecting), { rootMargin: "-57px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const byId = (rows: { id: string; code: string; name: string }[] | undefined, id: string | null) => rows?.find((r) => r.id === id);
  const cat = byId(cats.data, m.resort_category_id);
  const season = byId(seasons.data, m.season_id);
  const unit = byId(units.data, m.unit_type_id);
  const names = m.applicants.slice().sort((a, b) => a.position - b.position).map((a) => a.full_name).join(" & ");
  const thisYear = ent.data?.years.find((y) => y.year === year);
  const next = ent.data?.upcoming.slice().sort((a, b) => a.check_in.localeCompare(b.check_in))[0];
  const asfThisYear = asf.data?.find((y) => y.membership_year === year);
  const openNotice = notices.data?.find((n) => n.status === "OPEN") ?? notices.data?.[0];
  const noticeDays = openNotice ? daysFromToday(openNotice.deadline) : null;

  return (
    <>
      <div ref={sentinel} aria-hidden />
      <section
        aria-label="Member summary"
        className={cn(
          "sticky top-topbar z-10 -mx-4 border-b border-border bg-bg/95 px-4 pb-3 pt-1 backdrop-blur transition-shadow sm:-mx-6 sm:px-6",
          stuck && "shadow-sticky",
        )}
      >
        <div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="min-w-0 text-xl font-semibold leading-7 sm:text-2xl sm:leading-8">
                <Mono className="text-primary">{m.membership_number}</Mono>{" "}
                <span className="font-semibold text-fg">{names}</span>
              </h1>
              <CopyButton value={m.membership_number} label="Copy membership number" />
              <BrandChip companyId={m.company_id} />
              <StatusBadge status={m.status} />
              <button
                type="button"
                onClick={() => setMore(!more)}
                aria-expanded={more}
                className="ml-auto inline-flex h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary sm:hidden"
              >
                {more ? "Less" : "More"}<ChevronDown aria-hidden className={cn("size-4 transition-transform", more && "rotate-180")} />
              </button>
            </div>
            <div className={cn("mt-2 flex-wrap items-center gap-1.5", more ? "flex" : "hidden sm:flex")}>
              <CategoryChip code={cat?.code} name={cat?.name} />
              <SeasonChip code={season?.code} name={season ? `${season.name} season` : undefined} />
              {unit && <Chip>{unit.code} · {unit.name}</Chip>}
              <Chip><MoonStar aria-hidden className="size-3" />{formatNights(m.nights_per_year)} nights / year</Chip>
              <Chip>{m.first_year_of_use}–{m.last_year_of_use}</Chip>
              <span className="text-xs text-fg-subtle">Member ID <Mono>{m.id}</Mono></span>
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {can("entitlement.view") && (
            <StatTile
              label={`Nights left in ${year}`}
              icon={<MoonStar />}
              value={thisYear ? formatNights(thisYear.remaining) : m.status === "PENDING_APPROVAL" ? "—" : ent.isLoading ? "…" : "0.0"}
              sub={thisYear ? `of ${formatNights(Number(thisYear.allocated) + Number(thisYear.bonus) + Number(thisYear.saved_in))} available` : m.status === "PENDING_APPROVAL" ? "After approval" : undefined}
              href={`/members/${m.id}?tab=entitlement`}
              className="py-2"
            />
          )}
          {can("finance.view") && (
            <StatTile
              label="Outstanding balance"
              icon={<Wallet />}
              value={fin.data ? (fin.data.balance_display === "NIL" ? "NIL" : <Money value={fin.data.balance} currency={fin.data.currency} />) : "…"}
              tone={fin.data && fin.data.balance_display !== "NIL" && m.status === "DEFAULT_NOTICE" ? "danger" : "default"}
              sub={m.balance_mode === "EMI" ? "Paying by EMI" : undefined}
              href={`/members/${m.id}?tab=finance`}
              className={cn("py-2", !more && "hidden sm:block")}
            />
          )}
          {can("entitlement.view") && (
            <StatTile
              label="Next check-in"
              icon={<CalendarDays />}
              value={next ? formatDate(next.check_in) : "None booked"}
              sub={next ? `${next.reservation_number} · ${formatRelativeDays(next.check_in)}` : undefined}
              href={next ? `/reservations/${next.id}` : `/members/${m.id}?tab=reservations`}
              className={cn("py-2", !more && "hidden sm:block")}
            />
          )}
          {can("finance.view") && (
            <StatTile
              label={`ASF ${year}`}
              icon={<Receipt />}
              value={asfThisYear ? <StatusBadge status={asfThisYear.status} /> : "—"}
              tone={asfThisYear?.status === "RAISED" ? "warning" : "default"}
              sub={asfThisYear?.status === "RAISED" ? "Raised, unpaid" : asfThisYear?.status === "PAID" ? "Paid for this year" : "Raised at first booking"}
              href={`/members/${m.id}?tab=finance`}
              className="py-2"
            />
          )}
        </div>
      </section>

      {m.status === "DEFAULT_NOTICE" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3">
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-fg">Default notice issued{openNotice ? ` on ${formatDate(openNotice.issued_on)}` : ""}</p>
            <p className="text-base text-fg-muted">
              {openNotice ? (
                <>
                  <Money value={openNotice.amount_overdue} /> overdue. Deadline {formatDate(openNotice.deadline)}
                  {noticeDays !== null && <strong className="ml-1 text-danger">({noticeDays >= 0 ? `${noticeDays} ${noticeDays === 1 ? "day" : "days"} left` : `${-noticeDays} days past`})</strong>}
                </>
              ) : "Payment is overdue. See the Finance tab for the notice and deadline."}
            </p>
          </div>
          {can("finance.view") && <Link href={`/members/${m.id}?tab=finance`} className={buttonClasses({ variant: "outline", size: "sm" })}>Open finance</Link>}
        </div>
      )}
      {m.status === "TERMINATED" && (
        <div role="status" className="flex items-center gap-3 rounded-lg border border-danger/30 bg-danger-subtle px-4 py-3 text-base">
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-danger" />
          Membership terminated. Payments are forfeited; the outstanding balance remains a liability.
        </div>
      )}
    </>
  );
}
