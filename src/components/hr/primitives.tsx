import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "warning" | "success" | "destructive";
}) {
  const toneClass = {
    default: "text-primary bg-primary/10",
    warning: "text-warning bg-warning/15",
    success: "text-success bg-success/15",
    destructive: "text-destructive bg-destructive/10",
  }[tone];

  return (
    <div className="surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {icon ? (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              toneClass,
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-success/15 text-success border-success/30",
  approved: "bg-success/15 text-success border-success/30",
  completed: "bg-success/15 text-success border-success/30",
  verified: "bg-success/15 text-success border-success/30",
  present: "bg-success/15 text-success border-success/30",
  published: "bg-success/15 text-success border-success/30",
  resolved: "bg-success/15 text-success border-success/30",
  hired: "bg-success/15 text-success border-success/30",
  promoted: "bg-success/15 text-success border-success/30",
  transferred: "bg-info/15 text-info border-info/30",
  terminated: "bg-destructive/10 text-destructive border-destructive/30",
  offboarded: "bg-destructive/10 text-destructive border-destructive/30",
  departed: "bg-destructive/10 text-destructive border-destructive/30",
  open: "bg-info/15 text-info border-info/30",
  in_progress: "bg-info/15 text-info border-info/30",
  interview: "bg-info/15 text-info border-info/30",
  screening: "bg-info/15 text-info border-info/30",
  applied: "bg-muted text-muted-foreground border-border",
  draft: "bg-muted text-muted-foreground border-border",
  closed: "bg-muted text-muted-foreground border-border",
  pending: "bg-warning/20 text-warning-foreground border-warning/40",
  probation: "bg-warning/20 text-warning-foreground border-warning/40",
  waiting_employee: "bg-warning/20 text-warning-foreground border-warning/40",
  late: "bg-warning/20 text-warning-foreground border-warning/40",
  half_day: "bg-warning/20 text-warning-foreground border-warning/40",
  early_departure: "bg-warning/20 text-warning-foreground border-warning/40",
  cancelled: "bg-muted text-muted-foreground border-border",
  on_hold: "bg-warning/20 text-warning-foreground border-warning/40",
  overdue: "bg-destructive/10 text-destructive border-destructive/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  absent: "bg-destructive/10 text-destructive border-destructive/30",
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-warning/20 text-warning-foreground border-warning/40",
  info: "bg-info/15 text-info border-info/30",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = (status ?? "unknown").toLowerCase();
  return (
    <Badge
      variant="outline"
      className={cn(
        "border font-medium capitalize",
        STATUS_TONE[key] ?? "bg-muted text-muted-foreground",
      )}
    >
      {key.replace(/_/g, " ")}
    </Badge>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card p-5", className)}>
      {title ? (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
