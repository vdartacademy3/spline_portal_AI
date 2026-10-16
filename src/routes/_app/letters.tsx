import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, Plus, Sparkles } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { generateHrDocument } from "@/lib/ai.functions";
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/letters")({
  head: () => ({
    meta: [
      { title: "Letters — Spine AI" },
      {
        name: "description",
        content:
          "Issue and manage employment letters — appointment, promotion, probation, offering and more.",
      },
      { property: "og:title", content: "Letters — Spine AI" },
      { property: "og:description", content: "Official employment letters for your workforce." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LettersPage,
});

const LETTER_TYPES = [
  "appointment",
  "offer",
  "promotion",
  "probation_confirmation",
  "transfer",
  "increment",
  "warning",
  "confirmation",
  "experience",
  "relieving",
  "other",
];

function LettersPage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [letterType, setLetterType] = useState(LETTER_TYPES[0]!);
  const [employeeId, setEmployeeId] = useState("");
  const [drafting, setDrafting] = useState(false);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const lettersQuery = useQuery({
    queryKey: ["letters"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_letters")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createLetter = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      if (!employeeId) throw new Error("Select an employee.");
      const { data, error } = await supabase
        .from("employee_letters")
        .insert({
          employee_id: employeeId,
          letter_type: letterType,
          title: String(form["title"] ?? ""),
          content: String(form["content"] ?? ""),
          status: "draft",
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "letter.created",
        entity: "employee_letters",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Letter draft created");
      setOpen(false);
      resetForm();
      void queryClient.invalidateQueries({ queryKey: ["letters"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The letter could not be created."),
  });

  const draftWithAi = useMutation({
    mutationFn: async () => {
      setDrafting(true);
      const target = employeesQuery.data?.find((e) => e.id === employeeId);
      const name = target ? `${target.first_name} ${target.last_name}` : "[Employee Name]";
      const result = await generateHrDocument({
        data: {
          template: letterType.replace(/_/g, " "),
          instructions: `${title || "Draft based on the letter type"}. Employee: ${name}.`,
        },
      });
      return result.body;
    },
    onSuccess: (body) => {
      setContent(body);
      toast.success("Draft generated — review and edit before saving");
    },
    onError: () =>
      toast.error("Spine AI could not draft this letter. AI may not be configured yet."),
  });

  const issue = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("employee_letters")
        .update({
          status: "issued",
          issued_by: user?.id ?? null,
          issued_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "letter.issued",
        entity: "employee_letters",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Letter issued");
      void queryClient.invalidateQueries({ queryKey: ["letters"] });
    },
    onError: () => toast.error("Only HR can issue letters."),
  });

  if (!canAccess("letters", roles, permissions))
    return <NoPermissionState what="employment letters" />;
  if (lettersQuery.isLoading) return <LoadingState rows={6} />;
  if (lettersQuery.isError) return <ErrorState message="Unable to load letters." />;

  const names = nameMap(employeesQuery.data ?? []);
  const letters = lettersQuery.data ?? [];
  const mine = employee ? letters.filter((l) => l.employee_id === employee.id) : [];
  const visible = hr ? letters : mine;
  const drafts = visible.filter((l) => l.status === "draft");
  const issued = visible.filter((l) => l.status === "issued");

  const resetForm = () => {
    setTitle("");
    setContent("");
    setLetterType(LETTER_TYPES[0]!);
    setEmployeeId("");
  };

  return (
    <>
      <PageHeader
        title="Letters"
        description="Draft and issue official employment letters for your workforce."
        actions={
          hr ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> New letter
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create employment letter</DialogTitle>
                </DialogHeader>
                <form
                  id="letter-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createLetter.mutate(
                      Object.fromEntries(new FormData(e.currentTarget).entries()),
                    );
                  }}
                >
                  <div className="space-y-1.5">
                    <Label>Employee</Label>
                    <input type="hidden" name="employee_id" value={employeeId} />
                    <Select value={employeeId} onValueChange={setEmployeeId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {(employeesQuery.data ?? []).map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {`${e.first_name} ${e.last_name}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Letter type</Label>
                    <input type="hidden" name="letter_type" value={letterType} />
                    <Select value={letterType} onValueChange={setLetterType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LETTER_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      name="title"
                      required
                      placeholder="Appointment Letter — Acme Corp"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="content">Content</Label>
                    <Textarea
                      id="content"
                      name="content"
                      rows={8}
                      required
                      placeholder="Dear [Name], We are pleased to offer you..."
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={draftWithAi.isPending || drafting}
                    onClick={() => draftWithAi.mutate()}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {draftWithAi.isPending ? "Drafting..." : "Draft with Spine AI"}
                  </Button>
                </form>
                <DialogFooter>
                  <Button type="submit" form="letter-form" disabled={createLetter.isPending}>
                    {createLetter.isPending ? "Saving..." : "Save draft"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="My letters"
          value={mine.length}
          tone="success"
          icon={<Mail className="h-4 w-4" />}
        />
        <StatCard
          label={hr ? "Total letters" : "Drafts"}
          value={hr ? visible.length : drafts.length}
        />
        <StatCard label="Issued" value={issued.length} tone="success" />
        <StatCard label="Draft" value={drafts.length} tone="warning" />
      </div>

      <SectionCard title={hr ? "Letters" : "My letters"} className="mt-6">
        {visible.length === 0 ? (
          <EmptyState title="No letters yet." />
        ) : (
          <ul className="space-y-3">
            {visible.map((l) => (
              <li key={l.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {l.title}{" "}
                      <span className="text-muted-foreground">
                        · {names.get(l.employee_id) ?? "—"}
                      </span>
                    </p>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">
                      {l.letter_type.replace(/_/g, " ")} ·{" "}
                      {new Date(l.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground max-h-48 overflow-y-auto">
                  {l.content}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {l.status === "issued" && l.issued_at
                      ? `Issued ${new Date(l.issued_at).toLocaleDateString()}`
                      : "Pending issue"}
                  </p>
                  {hr && l.status === "draft" ? (
                    <Button size="sm" onClick={() => issue.mutate(l.id)}>
                      Issue letter
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
