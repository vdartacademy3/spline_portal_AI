import { AlertTriangle, Inbox, Lock } from "lucide-react";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function EmptyState({
  title = "Nothing here yet",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
      <Inbox className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-destructive" aria-hidden />
      <p className="font-medium text-foreground">Unable to load this information</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {message ?? "Please try again in a moment."}
      </p>
    </div>
  );
}

export function NoPermissionState({ what = "this information" }: { what?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
      <Lock className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="font-medium text-foreground">Access restricted</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Your account does not have permission to view {what}.
      </p>
    </div>
  );
}
