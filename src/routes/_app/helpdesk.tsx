import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, Link2 } from "lucide-react";
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
import { fetchEmployees, logAudit } from "@/lib/hr-queries";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/helpdesk")({
  head: () => ({
    meta: [
      { title: "HR Helpdesk — Spine AI" },
      {
        name: "description",
        content:
          "Raise and resolve HR requests with categories, priorities, SLA tracking and history.",
      },
      { property: "og:title", content: "HR Helpdesk — Spine AI" },
      { property: "og:description", content: "HR tickets, priorities, SLA and resolutions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HelpdeskPage,
});

const CATEGORIES = ["payroll", "leave", "policy", "it_access", "benefits", "workplace", "other"];
const PRIORITIES = ["low", "medium", "high", "critical"];

function HelpdeskPage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [resolveFor, setResolveFor] = useState<string | null>(null);

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: fetchEmployees,
    enabled: hr,
  });

  const ticketsQuery = useQuery({
    queryKey: ["tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helpdesk_tickets")
        .select(
          "id, subject, description, category, priority, status, employee_id, assigned_to, created_by, sla_due_at, resolved_at, escalated_at, escalation_level, resolution_summary, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const commentsQuery = useQuery({
    queryKey: ["ticket-comments", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_comments")
        .select("id, ticket_id, author, body, created_at")
        .eq("ticket_id", selected!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const historyQuery = useQuery({
    queryKey: ["ticket-history", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_status_history")
        .select("id, from_status, to_status, created_at")
        .eq("ticket_id", selected!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const internalNotesQuery = useQuery({
    queryKey: ["ticket-notes", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_internal_notes")
        .select("id, body, author, created_at")
        .eq("ticket_id", selected!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const attachmentsQuery = useQuery({
    queryKey: ["ticket-attachments", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_attachments")
        .select("id, name, file_path, created_at")
        .eq("ticket_id", selected!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createTicket = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const { error } = await supabase.from("helpdesk_tickets").insert({
        subject: form["subject"]!,
        description: form["description"] ?? "",
        category: form["category"] || "other",
        priority: form["priority"] || "medium",
        employee_id: employee?.id ?? null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "ticket.created",
        entity: "helpdesk_tickets",
        next: form,
      });
    },
    onSuccess: () => {
      toast.success("Request submitted");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: () => toast.error("Your request could not be submitted. Please try again."),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("ticket_comments").insert({
        ticket_id: selected!,
        author: user?.id ?? null,
        body: reply,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setReply("");
      void queryClient.invalidateQueries({ queryKey: ["ticket-comments", selected] });
    },
    onError: () => toast.error("Your reply could not be posted."),
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("ticket_internal_notes").insert({
        ticket_id: selected!,
        author: user?.id ?? null,
        body: note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["ticket-notes", selected] });
    },
    onError: () => toast.error("The note could not be saved."),
  });

  const addAttachment = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { error } = await supabase.from("ticket_attachments").insert({
        ticket_id: selected!,
        name: String(form["name"]),
        file_path: String(form["file_path"]),
        uploaded_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reference attached");
      void queryClient.invalidateQueries({ queryKey: ["ticket-attachments", selected] });
    },
    onError: () => toast.error("You cannot attach references to this ticket."),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("helpdesk_tickets")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "ticket.status_changed",
        entity: "helpdesk_tickets",
        entityId: id,
        next: { status },
      });
    },
    onSuccess: () => {
      toast.success("Ticket updated");
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: () => toast.error("You do not have permission to update this ticket."),
  });

  const resolveTicket = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = resolveFor;
      if (!id) throw new Error("No ticket selected.");
      const { error } = await supabase
        .from("helpdesk_tickets")
        .update({
          status: "resolved",
          resolution_summary: String(form["summary"] ?? "") || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "ticket.resolved",
        entity: "helpdesk_tickets",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Ticket resolved");
      setResolveFor(null);
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: () => toast.error("You do not have permission to resolve this ticket."),
  });

  const escalate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("helpdesk_tickets")
        .update({
          escalation_level: (activeTicket?.escalation_level ?? 0) + 1,
          escalated_at: new Date().toISOString(),
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "ticket.escalated",
        entity: "helpdesk_tickets",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Ticket escalated");
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: () => toast.error("Only HR can escalate tickets."),
  });

  const assign = useMutation({
    mutationFn: async ({ id, assignee }: { id: string; assignee: string }) => {
      const { data, error } = await supabase
        .from("helpdesk_tickets")
        .update({ assigned_to: assignee || null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("not-authorized");
      await logAudit({
        userId: user?.id,
        action: "ticket.assigned",
        entity: "helpdesk_tickets",
        entityId: id,
        next: { assigned_to: assignee || null },
      });
    },
    onSuccess: () => {
      toast.success("Ticket assigned");
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: () => toast.error("You do not have permission to assign this ticket."),
  });

  if (!canAccess("helpdesk", roles, permissions))
    return <NoPermissionState what="the HR helpdesk" />;
  if (ticketsQuery.isLoading) return <LoadingState rows={6} />;
  if (ticketsQuery.isError) return <ErrorState message="Unable to load helpdesk tickets." />;

  const tickets = ticketsQuery.data ?? [];
  const openTickets = tickets.filter((t) => t.status === "open");
  const inProgress = tickets.filter((t) => t.status === "in_progress");
  const resolved = tickets.filter((t) => t.status === "resolved");
  const critical = tickets.filter((t) => t.priority === "critical" && t.status !== "resolved");
  const breached = tickets.filter(
    (t) => t.status !== "resolved" && isSlaBreached(t.sla_due_at) && (t.sla_due_at ?? ""),
  );
  const activeTicket = tickets.find((t) => t.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title="HR Helpdesk"
        description="Raise HR requests and track them through to resolution with SLA awareness."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New request</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Raise an HR request</DialogTitle>
              </DialogHeader>
              <form
                id="ticket-form"
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  createTicket.mutate(Object.fromEntries(fd) as Record<string, string>);
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" name="subject" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Details</Label>
                  <Textarea id="description" name="description" rows={4} required />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <HiddenSelect
                    name="category"
                    label="Category"
                    options={CATEGORIES}
                    defaultValue="other"
                  />
                  <HiddenSelect
                    name="priority"
                    label="Priority"
                    options={PRIORITIES}
                    defaultValue="medium"
                  />
                </div>
              </form>
              <DialogFooter>
                <Button type="submit" form="ticket-form" disabled={createTicket.isPending}>
                  Submit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open" value={openTickets.length} />
        <StatCard label="In progress" value={inProgress.length} tone="warning" />
        <StatCard label="Resolved" value={resolved.length} tone="success" />
        <StatCard label="SLA breached" value={breached.length} tone="destructive" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <SectionCard title="Tickets">
          {tickets.length === 0 ? (
            <EmptyState
              title="No requests yet."
              description="Raise a request and HR will pick it up."
            />
          ) : (
            <ul className="space-y-2">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent ${
                      selected === t.id ? "border-primary bg-accent" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{t.subject}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <SlaBadge due={t.sla_due_at} status={t.status} />
                        <StatusBadge status={t.status} />
                      </div>
                    </div>
                    <p className="mt-1 text-xs capitalize text-muted-foreground">
                      {t.category.replace("_", " ")} · {t.priority} priority
                      {t.escalation_level > 0 ? ` · escalated L${t.escalation_level}` : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title={activeTicket ? activeTicket.subject : "Conversation"}>
          {!activeTicket ? (
            <EmptyState
              title="Select a ticket"
              description="Choose a request to see its conversation."
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={activeTicket.status} />
                <SlaBadge due={activeTicket.sla_due_at} status={activeTicket.status} />
                {activeTicket.escalation_level > 0 ? (
                  <span className="text-xs font-medium text-destructive">
                    Escalated L{activeTicket.escalation_level}
                  </span>
                ) : null}
              </div>
              {activeTicket.resolution_summary ? (
                <p className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-foreground">
                  <span className="font-medium">Resolution: </span>
                  {activeTicket.resolution_summary}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">{activeTicket.description}</p>
              {hr ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {["open", "in_progress", "waiting_employee", "resolved"].map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={activeTicket.status === s ? "default" : "outline"}
                        onClick={() => setStatus.mutate({ id: activeTicket.id, status: s })}
                      >
                        {s.replace("_", " ")}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeTicket.status !== "resolved" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setResolveFor(activeTicket.id)}
                        >
                          <CheckCircle2 className="mr-1.5 h-4 w-4" /> Resolve & summarize
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => escalate.mutate(activeTicket.id)}
                        >
                          <ArrowUpRight className="mr-1.5 h-4 w-4" /> Escalate
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Assigned to</Label>
                    <Select
                      value={activeTicket.assigned_to ?? ""}
                      onValueChange={(v) => assign.mutate({ id: activeTicket.id, assignee: v })}
                    >
                      <SelectTrigger className="h-9 w-64">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        {(employeesQuery.data ?? []).map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.first_name} {e.last_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              <ul className="space-y-2">
                {(commentsQuery.data ?? []).map((c) => (
                  <li key={c.id} className="rounded-lg border p-3">
                    <p className="text-sm">{c.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reply.trim()) addComment.mutate();
                }}
              >
                <Input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a reply..."
                />
                <Button type="submit" disabled={addComment.isPending}>
                  Reply
                </Button>
              </form>
              {hr ? (
                <form
                  className="space-y-2 border-t pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (note.trim()) addNote.mutate();
                  }}
                >
                  <Label>Internal note (not visible to the requester)</Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                  <Button type="submit" size="sm" variant="outline" disabled={addNote.isPending}>
                    Add internal note
                  </Button>
                </form>
              ) : null}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between">
                  <Label>Attachments & references</Label>
                  {hr ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        if (String(fd.get("file_path") ?? "").trim())
                          addAttachment.mutate(Object.fromEntries(fd.entries()));
                      }}
                    >
                      <Input name="name" placeholder="Label" className="h-8 w-32" />
                      <Input name="file_path" placeholder="URL or path" className="h-8 w-48" />
                      <Button type="submit" size="sm" variant="outline">
                        <Link2 className="mr-1.5 h-4 w-4" /> Attach
                      </Button>
                    </form>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1">
                  {(attachmentsQuery.data ?? []).map((a) => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{a.name}</span>
                      <a
                        href={a.file_path}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline underline-offset-2"
                      >
                        open
                      </a>
                    </li>
                  ))}
                  {(attachmentsQuery.data ?? []).length === 0 ? (
                    <li className="text-xs text-muted-foreground">No attachments or references.</li>
                  ) : null}
                </ul>
              </div>
              <div className="border-t pt-3">
                <Label>Status history</Label>
                <ol className="mt-2 space-y-1">
                  {(historyQuery.data ?? []).map((h) => (
                    <li key={h.id} className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()} — {h.from_status ?? "created"} →{" "}
                      {h.to_status}
                    </li>
                  ))}
                  {(historyQuery.data ?? []).length === 0 ? (
                    <li className="text-xs text-muted-foreground">No status changes yet.</li>
                  ) : null}
                </ol>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <Dialog
        open={resolveFor !== null}
        onOpenChange={(o) => {
          if (!o) setResolveFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve ticket</DialogTitle>
          </DialogHeader>
          <form
            id="resolve-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              resolveTicket.mutate(Object.fromEntries(fd.entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="summary">Resolution summary</Label>
              <Textarea id="summary" name="summary" rows={3} required />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="resolve-form" disabled={resolveTicket.isPending}>
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function isSlaBreached(due: string | null) {
  return Boolean(due && new Date(due).getTime() < Date.now());
}

function SlaBadge({ due, status }: { due: string | null; status: string }) {
  if (status === "resolved" || !due) return null;
  const breached = isSlaBreached(due);
  const hoursLeft = Math.max(0, Math.floor((new Date(due).getTime() - Date.now()) / 3_600_000));
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        breached
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : hoursLeft <= 4
            ? "border-warning/40 bg-warning/20 text-warning-foreground"
            : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {breached ? `SLA ${hoursLeft}h over` : `SLA ${hoursLeft}h`}
    </span>
  );
}

function HiddenSelect({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: string[];
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="capitalize">
              {o.replace("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
