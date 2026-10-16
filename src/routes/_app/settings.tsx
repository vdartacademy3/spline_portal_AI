import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState } from "@/components/hr/states";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Spine AI" },
      {
        name: "description",
        content: "Manage your profile, appearance, notifications and change requests.",
      },
      { property: "og:title", content: "Settings — Spine AI" },
      { property: "og:description", content: "Profile, appearance and notifications." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const REQUESTABLE_FIELDS = [
  { key: "phone", label: "Phone number" },
  { key: "work_email", label: "Work email" },
  { key: "emergency_contact", label: "Emergency contact" },
  { key: "gender", label: "Gender" },
  { key: "date_of_birth", label: "Date of birth" },
] as const;

function SettingsPage() {
  const { user, fullName, role, employee, roles, refresh } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const [name, setName] = useState(fullName);
  const [dark, setDark] = useState(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  const [reqOpen, setReqOpen] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name })
        .eq("id", user!.id);
      if (error) throw error;
      await refresh();
    },
    onSuccess: () => toast.success("Profile updated"),
    onError: () => toast.error("Your profile could not be updated."),
  });

  const resetPassword = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(user!.email!, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Password reset email sent"),
    onError: () => toast.error("We could not send the reset email."),
  });

  const requestsQuery = useQuery({
    queryKey: ["profile-change-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_change_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const submitRequest = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      if (!employee) throw new Error("No employee profile is linked to your account.");
      const { error } = await supabase.from("profile_change_requests").insert({
        employee_id: employee.id,
        field: String(form["field"]),
        current_value: String(form["current_value"] ?? "") || null,
        requested_value: String(form["requested_value"]),
        reason: String(form["reason"] ?? "") || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Change request submitted for HR review");
      setReqOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The request could not be submitted."),
  });

  const decideRequest = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { data: row, error: getError } = await supabase
        .from("profile_change_requests")
        .select("*")
        .eq("id", id)
        .single();
      if (getError) throw getError;
      const { error: updateError } = await supabase
        .from("profile_change_requests")
        .update({
          status: approve ? "approved" : "rejected",
          approver_id: employee?.id ?? null,
          decided_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (updateError) throw updateError;
      if (approve) {
        const column = FIELD_TO_COLUMN[row.field as keyof typeof FIELD_TO_COLUMN];
        if (column) {
          const { error: empError } = await supabase
            .from("employees")
            .update({ [column]: row.requested_value } as never)
            .eq("id", row.employee_id);
          if (empError) throw empError;
        }
      }
    },
    onSuccess: () => {
      toast.success("Request processed");
      void queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] });
    },
    onError: () => toast.error("You do not have permission to decide on this request."),
  });

  const cancelRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("profile_change_requests")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request cancelled");
      void queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] });
    },
    onError: () => toast.error("The request could not be cancelled."),
  });

  const requests = requestsQuery.data ?? [];
  const pending = requests.filter((r) => r.status === "pending");
  const pendingMine = pending.filter((r) => r.employee_id === employee?.id);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile, appearance, account security and change requests."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Profile">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ""} disabled />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Role</p>
                <p className="mt-1 text-sm font-medium">{ROLE_LABEL[role]}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Employee ID</p>
                <p className="mt-1 text-sm font-medium">{employee?.employee_code ?? "—"}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
                Save changes
              </Button>
              {employee ? (
                <Dialog open={reqOpen} onOpenChange={setReqOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline">Request profile change</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Request a profile change</DialogTitle>
                    </DialogHeader>
                    <form
                      id="pcr-form"
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        submitRequest.mutate(Object.fromEntries(fd.entries()));
                      }}
                    >
                      <div className="space-y-1.5">
                        <Label>Field</Label>
                        <FieldSelect />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="current_value">Current value</Label>
                        <Input
                          id="current_value"
                          name="current_value"
                          placeholder="What HR currently has on file"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="requested_value">Requested value</Label>
                        <Input id="requested_value" name="requested_value" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reason">Reason</Label>
                        <Textarea id="reason" name="reason" rows={3} />
                      </div>
                    </form>
                    <DialogFooter>
                      <Button type="submit" form="pcr-form" disabled={submitRequest.isPending}>
                        {submitRequest.isPending ? "Submitting..." : "Submit request"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Appearance">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Dark mode</p>
                <p className="text-xs text-muted-foreground">Comfortable viewing in low light.</p>
              </div>
              <Switch
                checked={dark}
                onCheckedChange={(v) => {
                  setDark(v);
                  document.documentElement.classList.toggle("dark", v);
                }}
                aria-label="Toggle dark mode"
              />
            </div>
          </SectionCard>

          <SectionCard title="Security">
            <p className="text-sm text-muted-foreground">
              We will email you a secure link to set a new password.
            </p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => resetPassword.mutate()}
              disabled={resetPassword.isPending || !user?.email}
            >
              Send password reset email
            </Button>
          </SectionCard>
        </div>
      </div>

      <div className="mt-6">
        <SectionCard
          title="Profile change requests"
          description={
            hr
              ? "Decide or track requests across your authorized scope."
              : "Requests you have submitted"
          }
        >
          {requests.length === 0 ? (
            <EmptyState title="No change requests yet." />
          ) : (
            <ul className="space-y-3">
              {(hr ? pending : pendingMine).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{fieldLabel(r.field)}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {r.current_value || "—"} →{" "}
                      <span className="text-foreground">{r.requested_value}</span>
                    </p>
                    {r.reason ? (
                      <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                    ) : null}
                  </div>
                  {hr ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decideRequest.mutate({ id: r.id, approve: true })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => decideRequest.mutate({ id: r.id, approve: false })}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => cancelRequest.mutate(r.id)}>
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}

const FIELD_TO_COLUMN = {
  phone: "phone",
  work_email: "work_email",
  emergency_contact: "emergency_contact",
  gender: "gender",
  date_of_birth: "date_of_birth",
} as const;

function fieldLabel(field: string) {
  return REQUESTABLE_FIELDS.find((f) => f.key === field)?.label ?? field.replace(/_/g, " ");
}

function FieldSelect() {
  const [value, setValue] = useState<string>(REQUESTABLE_FIELDS[0]!.key);
  return (
    <>
      <input type="hidden" name="field" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REQUESTABLE_FIELDS.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
