import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader, SectionCard, StatCard } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { canAccess } from "@/lib/rbac";

export const Route = createFileRoute("/_app/admin/audit")({
  head: () => ({
    meta: [
      { title: "Audit Logs — Spine AI" },
      {
        name: "description",
        content: "Immutable record of who did what, when, across HR data and AI-assisted actions.",
      },
      { property: "og:title", content: "Audit Logs — Spine AI" },
      { property: "og:description", content: "Who changed what, and when." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { roles, permissions } = useAuth();
  const [search, setSearch] = useState("");

  const logsQuery = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, user_id, action, entity, entity_id, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });
  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!canAccess("audit", roles, permissions)) return <NoPermissionState what="audit logs" />;
  if (logsQuery.isLoading) return <LoadingState rows={8} />;
  if (logsQuery.isError) return <ErrorState message="Unable to load audit logs." />;

  const people = new Map(
    (profilesQuery.data ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "User"]),
  );
  const logs = (logsQuery.data ?? []).filter((l) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      l.action.toLowerCase().includes(q) ||
      (l.entity ?? "").toLowerCase().includes(q) ||
      (people.get(l.user_id ?? "") ?? "").toLowerCase().includes(q)
    );
  });

  const today = new Date().toDateString();
  const todayCount = (logsQuery.data ?? []).filter(
    (l) => new Date(l.created_at).toDateString() === today,
  ).length;
  const aiCount = (logsQuery.data ?? []).filter((l) => l.action.startsWith("ai")).length;

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="A record of sensitive reads, changes and AI-assisted actions."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Recent entries" value={(logsQuery.data ?? []).length} />
        <StatCard label="Today" value={todayCount} />
        <StatCard label="AI-related" value={aiCount} />
        <StatCard
          label="Distinct actors"
          value={new Set((logsQuery.data ?? []).map((l) => l.user_id)).size}
        />
      </div>

      <SectionCard
        title="Activity"
        className="mt-6"
        actions={
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by action, table or person"
            className="w-64"
            aria-label="Filter audit log"
          />
        }
      >
        {logs.length === 0 ? (
          <EmptyState title="No matching activity." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden sm:table-cell">Record</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{people.get(l.user_id ?? "") ?? "System"}</TableCell>
                    <TableCell className="font-medium">{l.action.replace(/[._]/g, " ")}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {l.entity ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
