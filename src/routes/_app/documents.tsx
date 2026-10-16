import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Sparkles, Upload } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil, fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, hasPermission, isHr } from "@/lib/rbac";
import { generateHrDocument } from "@/lib/ai.functions";
import { getDocumentUrl, uploadEmployeeDocument } from "@/lib/documents.functions";

export const Route = createFileRoute("/_app/documents")({
  head: () => ({
    meta: [
      { title: "Documents — Spine AI" },
      {
        name: "description",
        content:
          "Central HR document register with expiry tracking and AI-assisted document drafting.",
      },
      { property: "og:title", content: "Documents — Spine AI" },
      { property: "og:description", content: "HR documents, expiry tracking and AI drafts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocumentsPage,
});

const TEMPLATES = [
  "Job Description",
  "Offer Letter",
  "Warning Letter",
  "Promotion Letter",
  "Experience Letter",
  "Relieving Letter",
  "HR Announcement",
  "Interview Questions",
  "Onboarding Checklist",
  "Performance Review Summary",
];

function DocumentsPage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [template, setTemplate] = useState(TEMPLATES[0]!);
  const [instructions, setInstructions] = useState("");
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const documentsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_documents")
        .select(
          "id, employee_id, name, category, expiry_date, verification_status, file_url, reviewer_id, verified_at, verification_comment, version, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const verificationsQuery = useQuery({
    queryKey: ["document-verifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_verifications")
        .select(
          "id, document_id, action, reviewer_id, comment, previous_status, new_status, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
  const generatedQuery = useQuery({
    queryKey: ["generated-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("id, template, title, body, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const upload = useMutation({
    mutationFn: async (fd: FormData) => {
      const file = fd.get("file");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload.");
      if (file.size > 20 * 1024 * 1024) throw new Error("File is larger than 20MB.");
      const buffer = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      buffer.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      return uploadEmployeeDocument({
        data: {
          employeeId: (fd.get("employee_id") as string) || null,
          name: (fd.get("name") as string) || file.name,
          category: (fd.get("category") as string) || "other",
          expiryDate: (fd.get("expiry_date") as string) || null,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          fileBase64: btoa(binary),
        },
      });
    },
    onSuccess: () => {
      toast.success("Document uploaded");
      setUploadOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Document upload failed. Please try again."),
  });

  async function openDocument(id: string) {
    try {
      const { url } = await getDocumentUrl({ data: { id } });
      window.open(url, "_blank", "noopener");
    } catch {
      toast.error("You are not authorized to open this file, or it is unavailable.");
    }
  }

  const decision = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = reviewing;
      if (!id) throw new Error("No document selected.");
      const doc = docs.find((d) => d.id === id);
      if (!doc) throw new Error("Document not found.");
      const action = String(form["action"]);
      const comment = String(form["comment"] ?? "");
      const next = action === "rejected" ? "rejected" : "verified";
      const { error } = await supabase
        .from("employee_documents")
        .update({
          verification_status: next,
          reviewer_id: employee?.id ?? null,
          verified_at: new Date().toISOString(),
          verification_comment: comment || null,
          version: (doc.version ?? 1) + 1,
        })
        .eq("id", id);
      if (error) throw error;
      const { error: traceError } = await supabase.from("document_verifications").insert({
        document_id: id,
        action,
        reviewer_id: employee?.id ?? null,
        comment: comment || null,
        previous_status: doc.verification_status,
        new_status: next,
      });
      if (traceError) throw traceError;
      await logAudit({
        userId: user?.id,
        action: `document.${action}`,
        entity: "employee_documents",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Document reviewed");
      setReviewing(null);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["document-verifications"] });
    },
    onError: () => toast.error("The document could not be reviewed."),
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("generated_documents").insert({
        template,
        title: `${template} draft`,
        body: draft,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "document.draft_saved",
        entity: "generated_documents",
      });
    },
    onSuccess: () => {
      toast.success("Draft saved for review");
      setGenOpen(false);
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["generated-documents"] });
    },
    onError: () => toast.error("The draft could not be saved."),
  });

  if (!canAccess("documents", roles, permissions)) return <NoPermissionState what="HR documents" />;
  if (documentsQuery.isLoading) return <LoadingState rows={6} />;
  if (documentsQuery.isError) return <ErrorState message="Unable to load documents." />;

  const names = nameMap(employeesQuery.data ?? []);
  const docs = documentsQuery.data ?? [];
  const expiring = docs.filter((d) => {
    const days = daysUntil(d.expiry_date);
    return days !== null && days >= 0 && days <= 30;
  });
  const pendingVerification = docs.filter((d) => d.verification_status === "pending");

  async function onGenerate() {
    setGenerating(true);
    try {
      const result = await generateHrDocument({ data: { template, instructions } });
      setDraft(result.body);
    } catch {
      toast.error("Spine AI could not draft this document right now.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description="Employee document register, expiry tracking and AI-drafted HR letters."
        actions={
          <div className="flex gap-2">
            <Dialog open={genOpen} onOpenChange={setGenOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Sparkles className="mr-2 h-4 w-4" /> Generate document
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>AI document generator</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Template</Label>
                    <Select value={template} onValueChange={setTemplate}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TEMPLATES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="instructions">Context and instructions</Label>
                    <Textarea
                      id="instructions"
                      rows={3}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="Who is this for, what should it cover, tone, key dates..."
                    />
                  </div>
                  <Button onClick={onGenerate} disabled={generating}>
                    {generating ? "Drafting..." : "Generate draft"}
                  </Button>
                  {draft ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="draft">Draft (editable — review before use)</Label>
                      <Textarea
                        id="draft"
                        rows={14}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                    </div>
                  ) : null}
                </div>
                <DialogFooter>
                  <Button
                    disabled={!draft || saveDraft.isPending}
                    onClick={() => saveDraft.mutate()}
                  >
                    Save draft for approval
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {hr ? (
              <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Upload className="mr-2 h-4 w-4" /> Add document
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add document</DialogTitle>
                  </DialogHeader>
                  <form
                    id="doc-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      upload.mutate(new FormData(e.currentTarget));
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Document name</Label>
                      <Input id="name" name="name" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="file">File</Label>
                      <Input id="file" name="file" type="file" required />
                      <p className="text-xs text-muted-foreground">Up to 20MB. Stored privately.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="category">Category</Label>
                      <Input
                        id="category"
                        name="category"
                        placeholder="contract, identity, certificate..."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="expiry_date">Expiry date</Label>
                      <Input id="expiry_date" name="expiry_date" type="date" />
                    </div>
                    <EmployeePicker
                      employees={(employeesQuery.data ?? []).map((e) => ({
                        id: e.id,
                        name: `${e.first_name} ${e.last_name}`,
                      }))}
                    />
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="doc-form" disabled={upload.isPending}>
                      {upload.isPending ? "Uploading..." : "Upload document"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        }
      />

      <Dialog
        open={reviewing !== null}
        onOpenChange={(o) => {
          if (!o) setReviewing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review document</DialogTitle>
          </DialogHeader>
          <form
            id="review-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              decision.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="action">Decision</Label>
              <DecisionSelect />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comment">Comment (visible to the employee)</Label>
              <Textarea id="comment" name="comment" rows={3} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="review-form" disabled={decision.isPending}>
              {decision.isPending ? "Saving..." : "Confirm decision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Documents" value={docs.length} icon={<FileText className="h-4 w-4" />} />
        <StatCard label="Expiring in 30 days" value={expiring.length} tone="warning" />
        <StatCard label="Pending verification" value={pendingVerification.length} tone="warning" />
        <StatCard label="AI drafts" value={(generatedQuery.data ?? []).length} />
      </div>

      {expiring.length ? (
        <SectionCard title="Documents expiring soon" className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Days left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiring.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>{names.get(d.employee_id ?? "") ?? "—"}</TableCell>
                  <TableCell>{d.expiry_date}</TableCell>
                  <TableCell>{daysUntil(d.expiry_date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      ) : null}

      <SectionCard title="All documents" className="mt-6">
        {docs.length === 0 ? (
          <EmptyState title="No documents recorded." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead className="hidden sm:table-cell">Expiry</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{names.get(d.employee_id ?? "") ?? "—"}</TableCell>
                    <TableCell className="hidden capitalize sm:table-cell">
                      {d.category.replace("_", " ")}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{d.expiry_date ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={d.verification_status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {hasPermission(roles, permissions, "manage_documents") &&
                        d.verification_status === "pending" ? (
                          <Button variant="outline" size="sm" onClick={() => setReviewing(d.id)}>
                            Review
                          </Button>
                        ) : null}
                        {d.file_url ? (
                          <Button variant="ghost" size="sm" onClick={() => void openDocument(d.id)}>
                            Open file
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">No file</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {(verificationsQuery.data ?? []).length ? (
        <SectionCard title="Verification history" className="mt-6">
          <ul className="space-y-3">
            {(verificationsQuery.data ?? []).map((v) => (
              <li key={v.id} className="flex flex-col gap-1 border-b py-2 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">
                    {docs.find((d) => d.id === v.document_id)?.name ?? "Document"}
                  </p>
                  <StatusBadge status={v.new_status ?? v.action} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.action === "verified" ? "Verified" : "Rejected"}{" "}
                  {v.new_status !== v.previous_status ? `from ${v.previous_status}` : ""} ·{" "}
                  {new Date(v.created_at).toLocaleString()}
                </p>
                {v.comment ? <p className="text-sm text-muted-foreground">{v.comment}</p> : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {(generatedQuery.data ?? []).length ? (
        <SectionCard
          title="AI generated drafts"
          description="Review and approve before use"
          className="mt-6"
        >
          <ul className="space-y-3">
            {(generatedQuery.data ?? []).map((g) => (
              <li key={g.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{g.title}</p>
                  <StatusBadge status={g.status} />
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {g.body}
                </p>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </>
  );
}

function DecisionSelect() {
  const [value, setValue] = useState("verified");
  return (
    <>
      <input type="hidden" name="action" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="verified">Verified — authentic and legible</SelectItem>
          <SelectItem value="rejected">Rejected — needs re-submission</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

function EmployeePicker({ employees }: { employees: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-1.5">
      <Label>Employee</Label>
      <input type="hidden" name="employee_id" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Select employee" />
        </SelectTrigger>
        <SelectContent>
          {employees.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
