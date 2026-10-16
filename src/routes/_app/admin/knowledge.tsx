import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/hr-queries";
import { syncKnowledgeEmbeddings } from "@/lib/knowledge.functions";
import { canAccess } from "@/lib/rbac";

export const Route = createFileRoute("/_app/admin/knowledge")({
  head: () => ({
    meta: [
      { title: "AI Knowledge Base — Spine AI" },
      {
        name: "description",
        content:
          "Policies and handbooks that ground Spine AI answers, with sections and publication status.",
      },
      { property: "og:title", content: "AI Knowledge Base — Spine AI" },
      { property: "og:description", content: "Policy sources that ground AI answers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: KnowledgePage,
});

function KnowledgePage() {
  const { roles, permissions, user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const docsQuery = useQuery({
    queryKey: ["kb-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kb_documents")
        .select("id, title, category, status, version, content, created_at")
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });
  const chunksQuery = useQuery({
    queryKey: ["kb-chunks", expanded],
    enabled: !!expanded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kb_chunks")
        .select("id, heading, content")
        .eq("document_id", expanded!)
        .order("chunk_index");
      if (error) throw error;
      return data ?? [];
    },
  });

  const reindex = useMutation({
    mutationFn: async () => syncKnowledgeEmbeddings({ data: { force: false } }),
    onSuccess: (r) =>
      toast.success(
        r.embedded
          ? `${r.embedded} section${r.embedded === 1 ? "" : "s"} are now searchable by meaning.`
          : "Everything is already up to date.",
      ),
    onError: () => toast.error("The knowledge base could not be prepared for search."),
  });

  const addDoc = useMutation({
    mutationFn: async (form: { title: string; category: string; content: string }) => {
      const { data, error } = await supabase
        .from("kb_documents")
        .insert({ title: form.title, category: form.category || "policy", content: form.content })
        .select("id")
        .single();
      if (error) throw error;

      const sections = form.content
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sections.length) {
        const { error: chunkError } = await supabase.from("kb_chunks").insert(
          sections.map((content, i) => ({
            document_id: data.id,
            chunk_index: i,
            heading: content.split("\n")[0]!.slice(0, 120),
            content,
          })),
        );
        if (chunkError) throw chunkError;
      }
      await logAudit({
        userId: user?.id,
        action: "kb.document_created",
        entity: "kb_documents",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Policy added to the knowledge base");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["kb-documents"] });
    },
    onError: () => toast.error("The policy could not be saved."),
  });

  if (!canAccess("knowledge", roles, permissions))
    return <NoPermissionState what="the AI knowledge base" />;
  if (docsQuery.isLoading) return <LoadingState rows={5} />;
  if (docsQuery.isError) return <ErrorState message="Unable to load the knowledge base." />;

  const docs = docsQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="AI Knowledge Base"
        description="Spine AI answers policy questions only from these published sources."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={reindex.isPending} onClick={() => reindex.mutate()}>
              {reindex.isPending ? "Preparing…" : "Prepare for search"}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>Add policy</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add a policy document</DialogTitle>
                </DialogHeader>
                <form
                  id="kb-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    addDoc.mutate({
                      title: String(fd.get("title")),
                      category: String(fd.get("category") ?? ""),
                      content: String(fd.get("content") ?? ""),
                    });
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" name="title" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="category">Category</Label>
                    <Input
                      id="category"
                      name="category"
                      placeholder="leave, conduct, benefits..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="content">Content</Label>
                    <Textarea
                      id="content"
                      name="content"
                      rows={12}
                      required
                      placeholder="Paste the policy. Separate sections with a blank line."
                    />
                  </div>
                </form>
                <DialogFooter>
                  <Button type="submit" form="kb-form" disabled={addDoc.isPending}>
                    Save policy
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Documents" value={docs.length} />
        <StatCard
          label="Published"
          value={docs.filter((d) => d.status === "published").length}
          tone="success"
        />
        <StatCard
          label="Drafts"
          value={docs.filter((d) => d.status === "draft").length}
          tone="warning"
        />
        <StatCard label="Categories" value={new Set(docs.map((d) => d.category)).size} />
      </div>

      <SectionCard title="Policy sources" className="mt-6">
        {docs.length === 0 ? (
          <EmptyState
            title="No policies yet."
            description="Add a policy so Spine AI can answer questions about it."
          />
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {d.category} · v{d.version ?? "1"} · added{" "}
                      {new Date(d.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={d.status} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                    >
                      {expanded === d.id ? "Hide" : "View sections"}
                    </Button>
                  </div>
                </div>
                {expanded === d.id ? (
                  <ul className="mt-3 space-y-2 border-t pt-3">
                    {(chunksQuery.data ?? []).map((c) => (
                      <li key={c.id}>
                        <p className="text-sm font-medium">{c.heading}</p>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {c.content}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
