/* Status stepper: the normal path, where the record is, and (via children) the next allowed actions.
 * Off-path end states (Not interested, Declined, Cancelled) are shown instead of the path's next steps. */
import { Check } from "lucide-react";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusStepper({ path, current, offPath = [], label, children }: { path: string[]; current: string; offPath?: string[]; label: string; children?: React.ReactNode }) {
  const idx = path.indexOf(current);
  const isOff = offPath.includes(current);
  return (
    <div className="flex flex-col gap-4">
      <ol aria-label={label} className="flex flex-wrap items-center gap-y-2">
        {path.map((s, i) => {
          const done = idx > i || (idx === i && i === path.length - 1);
          const cur = idx === i && !done;
          return (
            <li key={s} className="flex items-center" aria-current={cur ? "step" : undefined}>
              <span className={cn(
                "flex items-center gap-2 text-sm",
                cur ? "font-semibold text-primary" : done ? "text-fg" : "text-fg-subtle",
                isOff && "text-fg-subtle",
              )}>
                <span aria-hidden className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums",
                  done && !isOff && "border-primary bg-primary text-fg-on-fill",
                  cur && "border-primary bg-surface text-primary ring-4 ring-accent-subtle",
                  !done && !cur && "border-border-strong/50 bg-surface text-fg-subtle",
                  isOff && "border-border-strong/40 bg-surface-sunken text-fg-subtle",
                )}>
                  {done && !isOff ? <Check className="size-3.5" /> : i + 1}
                </span>
                {humanize(s)}
                <span className="sr-only">{done ? "(done)" : cur ? "(current)" : ""}</span>
              </span>
              {i < path.length - 1 && <span aria-hidden className={cn("mx-2 h-0.5 w-6 rounded-full sm:w-10", idx > i && !isOff ? "bg-primary" : "bg-border")} />}
            </li>
          );
        })}
        {isOff && (
          <li className="ml-3 flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1 text-sm font-medium text-fg-muted" aria-current="step">
            {humanize(current)} <span className="sr-only">(current)</span>
          </li>
        )}
      </ol>
      {children}
    </div>
  );
}
