import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { executeAiAction } from "@/lib/actions.functions";
import { logAudit } from "@/lib/hr-queries";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/ai-actions")({
  head: () => ({
    meta: [
      { title: "AI Actions — Spine AI" },
      {
        name: "description",
        content: "Approve, reject or review every action Spine AI proposes before it takes effect.",
      },
      { property: "og:title", content: "AI Actions — Spine AI" },
      { property: "og:description", content: "Human approval queue for AI-proposed HR actions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AiActionsPage,
});

function AiActionsPage() {
  const { roles, permissions, user } = useAuth();
  const queryClient = useQueryClient();
  const approver = isHr(roles);

  const actionsQuery = useQuery({
    queryKey: ["ai-actions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_actions")
        .select("id, action_type, title, reason, risk_level, status, created_at, requested_by")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("ai_actions")
        .update({ status, approved_by: user?.id ?? null })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: `ai_action.${status}`,
        entity: "ai_actions",
        entityId: id,
      });
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === "approved" ? "Action approved" : "Action rejected");
      void queryClient.invalidateQueries({ queryKey: ["ai-actions"] });
    },
    onError: () => toast.error("You do not have permission to decide on this action."),
  });

  const execute = useMutation({
    mutationFn: async (id: string) => executeAiAction({ data: { actionId: id } }),
    onSuccess: (_d, id) => {
      toast.success("Action executed");
      void queryClient.invalidateQueries({ queryKey: ["ai-actions"] });
      void id;
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The action could not be executed."),
  });

  if (!canAccess("ai-actions", roles, permissions))
    return <NoPermissionState what="the AI action queue" />;
  if (actionsQuery.isLoading) return <LoadingState rows={5} />;
  if (actionsQuery.isError) return <ErrorState message="Unable to load AI actions." />;

  const actions = actionsQuery.data ?? [];
  const pending = actions.filter((a) => a.status === "pending");
  const approved = actions.filter((a) => a.status === "approved");
  const rejected = actions.filter((a) => a.status === "rejected");
  const highRisk = pending.filter((a) => a.risk_level === "high" || a.risk_level === "critical");

  return (
    <>
      <PageHeader
        title="AI Actions"
        description="Every consequential action Spine AI proposes waits here for a human decision."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Awaiting approval"
          value={pending.length}
          tone="warning"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <StatCard label="High risk pending" value={highRisk.length} tone="destructive" />
        <StatCard label="Approved" value={approved.length} tone="success" />
        <StatCard label="Rejected" value={rejected.length} />
      </div>

      <SectionCard title="Pending approvals" className="mt-6">
        {pending.length === 0 ? (
          <EmptyState
            title="Nothing awaiting approval."
            description="Proposed AI actions will appear here."
          />
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <li key={a.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{a.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{a.reason}</p>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">
                      {a.action_type.replace(/_/g, " ")} · {new Date(a.created_at).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={a.risk_level} />
                </div>
                {approver ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => decide.mutate({ id: a.id, status: "approved" })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => decide.mutate({ id: a.id, status: "rejected" })}
                    >
                      Reject
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Waiting on an HR approver.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Decision history" className="mt-6">
        {approved.length + rejected.length === 0 ? (
          <EmptyState title="No decisions recorded yet." />
        ) : (
          <ul className="space-y-2">
            {[...approved, ...rejected].map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={a.status} />
                  {approver && a.status === "approved" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={execute.isPending}
                      onClick={() => execute.mutate(a.id)}
                    >
                      Execute
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
