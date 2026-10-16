import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PageHeader, SectionCard, StatCard } from "@/components/hr/primitives";
import { ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, type AppRole } from "@/lib/rbac";

export const Route = createFileRoute("/_app/admin/ai")({
  head: () => ({
    meta: [
      { title: "AI Configuration — Spine AI" },
      {
        name: "description",
        content:
          "Review how Spine AI is grounded, which roles may use it, and the approval rules applied to every AI proposal.",
      },
      { property: "og:title", content: "AI Configuration — Spine AI" },
      { property: "og:description", content: "AI grounding, access and approval rules." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AiConfigPage,
});

function AiConfigPage() {
  const { roles } = useAuth();

  const query = useQuery({
    queryKey: ["ai-config"],
    enabled: roles.includes("super_admin"),
    queryFn: async () => {
      const [{ data: perms }, { data: docs }, { data: actions }, { data: messages }] =
        await Promise.all([
          supabase
            .from("role_permissions")
            .select("role, permission_code")
            .in("permission_code", ["use_ai", "manage_ai"]),
          supabase.from("kb_documents").select("id, title, status"),
          supabase.from("ai_actions").select("id, status, risk_level"),
          supabase.from("ai_messages").select("id", { count: "exact", head: false }).limit(1),
        ]);
      return {
        perms: perms ?? [],
        docs: docs ?? [],
        actions: actions ?? [],
        hasMessages: (messages ?? []).length > 0,
      };
    },
  });

  if (!roles.includes("super_admin")) return <NoPermissionState what="AI configuration" />;
  if (query.isLoading) return <LoadingState rows={4} />;
  if (query.isError) return <ErrorState message="Unable to load AI configuration." />;

  const { perms, docs, actions } = query.data!;
  const canUse = perms.filter((p) => p.permission_code === "use_ai").map((p) => p.role as AppRole);
  const canManage = perms
    .filter((p) => p.permission_code === "manage_ai")
    .map((p) => p.role as AppRole);
  const published = docs.filter((d) => d.status === "published").length;
  const pending = actions.filter((a) => a.status === "pending").length;

  return (
    <>
      <PageHeader
        title="AI Configuration"
        description="Spine AI answers only from data the person asking is allowed to see, and never executes a consequential change on its own."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Published policy documents" value={published} />
        <StatCard label="Total knowledge documents" value={docs.length} />
        <StatCard label="Proposals awaiting approval" value={pending} tone="warning" />
        <StatCard
          label="Roles allowed to use AI"
          value={canUse.length || (roles.includes("super_admin") ? 1 : 0)}
        />
      </div>

      <SectionCard title="Who can use Spine AI" className="mt-6">
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground">Can ask questions</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge>Super Admin</Badge>
              {canUse.map((r) => (
                <Badge key={r} variant="secondary">
                  {ROLE_LABEL[r]}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <p className="text-muted-foreground">Can approve AI proposals</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge>Super Admin</Badge>
              {canManage.map((r) => (
                <Badge key={r} variant="secondary">
                  {ROLE_LABEL[r]}
                </Badge>
              ))}
            </div>
          </div>
          <p className="text-muted-foreground">
            Change these in Roles &amp; Permissions. Access is enforced when the data is fetched, so
            removing a permission also stops the AI from reading that data.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/roles">Open Roles &amp; Permissions</Link>
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Safety rules in force" className="mt-4">
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>Answers are built only from records the signed-in person is authorised to read.</li>
          <li>Requests for information outside that boundary are refused rather than answered.</li>
          <li>Compensation and other sensitive details require the sensitive-data permission.</li>
          <li>Consequential actions become proposals that a human must approve.</li>
          <li>Every question, proposal, approval and rejection is written to the audit log.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Grounding" className="mt-4">
        <p className="text-sm text-muted-foreground">
          Spine AI is grounded in the published policy documents of your knowledge base. Unpublished
          drafts are never used to answer questions.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/admin/knowledge">Open Knowledge Base</Link>
        </Button>
      </SectionCard>
    </>
  );
}
