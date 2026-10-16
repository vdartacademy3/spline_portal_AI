import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader, StatusBadge } from "@/components/hr/primitives";
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
import { terminateEmployee } from "@/lib/employees.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchDepartments,
  fetchEmployees,
  fetchLocations,
  fetchOrganization,
  labelMap,
  logAudit,
  nameMap,
  type EmployeeRow,
} from "@/lib/hr-queries";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/employees/")({
  head: () => ({
    meta: [
      { title: "Employee Directory — Spine AI" },
      {
        name: "description",
        content: "Search, filter and manage the employees you are authorized to view.",
      },
      { property: "og:title", content: "Employee Directory — Spine AI" },
      { property: "og:description", content: "Permission-aware employee directory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EmployeesPage,
});

const PAGE_SIZE = 12;

function EmployeesPage() {
  const { roles, permissions, user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [terminating, setTerminating] = useState<EmployeeRow | null>(null);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const organizationQuery = useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });

  const createEmployee = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const organizationId = organizationQuery.data?.id;
      if (!organizationId) throw new Error("No organization is configured yet.");
      const { data, error } = await supabase
        .from("employees")
        .insert({
          employee_code: form["employee_code"]!,
          first_name: form["first_name"]!,
          last_name: form["last_name"]!,
          work_email: form["work_email"] || null,
          designation: form["designation"] || null,
          department_id: form["department_id"] || null,
          location_id: form["location_id"] || null,
          manager_id: form["manager_id"] || null,
          joining_date: form["joining_date"] || new Date().toISOString().slice(0, 10),
          organization_id: organizationId,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "employee.created",
        entity: "employees",
        entityId: data.id,
        next: form,
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Employee created");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error && e.message.includes("organization")
          ? "No organization is configured yet. Set one up under Organization first."
          : "Unable to create the employee. Please check the details and try again.",
      ),
  });

  const updateEmployee = useMutation({
    mutationFn: async ({ record, form }: { record: EmployeeRow; form: Record<string, string> }) => {
      const patch = {
        designation: form["designation"] || null,
        work_email: form["work_email"] || null,
        phone: form["phone"] || null,
        department_id: form["department_id"] || null,
        location_id: form["location_id"] || null,
        manager_id: form["manager_id"] || null,
        employment_status: form["employment_status"] || record.employment_status,
      };
      const { data, error } = await supabase
        .from("employees")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", record.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("not-authorized");
      await logAudit({
        userId: user?.id,
        action: "employee.updated",
        entity: "employees",
        entityId: record.id,
        previous: record,
        next: patch,
      });
    },
    onSuccess: () => {
      toast.success("Employee updated");
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error && e.message === "not-authorized"
          ? "You are not authorized to edit this employee."
          : "The employee could not be updated.",
      ),
  });

  const terminateMutation = useMutation({
    mutationFn: ({
      employeeId,
      effectiveDate,
      reason,
    }: {
      employeeId: string;
      effectiveDate: string;
      reason: string;
    }) => terminateEmployee({ data: { employeeId, effectiveDate, reason } }),
    onSuccess: () => {
      toast.success("Employee terminated");
      setTerminating(null);
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "This employee could not be terminated."),
  });

  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const deptNames = labelMap(departmentsQuery.data ?? []);
  const locNames = labelMap(locationsQuery.data ?? []);
  const managers = nameMap(employees);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees.filter((e) => {
      const matchesTerm =
        !term ||
        `${e.first_name} ${e.last_name} ${e.employee_code} ${e.designation ?? ""}`
          .toLowerCase()
          .includes(term);
      const matchesDept = dept === "all" || e.department_id === dept;
      const matchesStatus = status === "all" || e.employment_status === status;
      return matchesTerm && matchesDept && matchesStatus;
    });
  }, [employees, search, dept, status]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (!canAccess("employees", roles, permissions))
    return <NoPermissionState what="the employee directory" />;

  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone you are authorized to view, with live organization data."
        actions={
          isHr(roles) ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Create employee
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create employee</DialogTitle>
                </DialogHeader>
                <form
                  id="create-employee"
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    createEmployee.mutate(Object.fromEntries(fd) as Record<string, string>);
                  }}
                >
                  <Field name="employee_code" label="Employee code" required />
                  <Field name="joining_date" label="Joining date" type="date" required />
                  <Field name="first_name" label="First name" required />
                  <Field name="last_name" label="Last name" required />
                  <Field name="work_email" label="Work email" type="email" />
                  <Field name="designation" label="Designation" />
                  <SelectField
                    name="department_id"
                    label="Department"
                    options={(departmentsQuery.data ?? []).map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                  />
                  <SelectField
                    name="location_id"
                    label="Location"
                    options={(locationsQuery.data ?? []).map((l) => ({
                      value: l.id,
                      label: l.name,
                    }))}
                  />
                  <SelectField
                    name="manager_id"
                    label="Reporting manager"
                    options={employees.map((e) => ({
                      value: e.id,
                      label: `${e.first_name} ${e.last_name}`,
                    }))}
                  />
                </form>
                <DialogFooter>
                  <Button type="submit" form="create-employee" disabled={createEmployee.isPending}>
                    {createEmployee.isPending ? "Creating..." : "Create employee"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="surface-card p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="Search by name, code or designation"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="sm:max-w-xs"
          />
          <Select
            value={dept}
            onValueChange={(v) => {
              setDept(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="sm:w-48">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {(departmentsQuery.data ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="probation">Probation</SelectItem>
              <SelectItem value="exited">Exited</SelectItem>
              <SelectItem value="terminated">Terminated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {employeesQuery.isLoading ? (
          <LoadingState />
        ) : employeesQuery.isError ? (
          <ErrorState message="Unable to load employee data. Please try again." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No employees found." description="Try a different search or filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="hidden md:table-cell">Department</TableHead>
                    <TableHead className="hidden lg:table-cell">Location</TableHead>
                    <TableHead className="hidden lg:table-cell">Manager</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <div className="font-medium">
                          {e.first_name} {e.last_name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.employee_code}
                          {e.designation ? ` · ${e.designation}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {deptNames.get(e.department_id ?? "") ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {locNames.get(e.location_id ?? "") ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {managers.get(e.manager_id ?? "") ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={e.employment_status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {isHr(roles) ? (
                          <>
                            {!["terminated", "exited"].includes(e.employment_status) ? (
                              <Button variant="ghost" size="sm" onClick={() => setTerminating(e)}>
                                Terminate
                              </Button>
                            ) : null}
                            <Button variant="ghost" size="sm" onClick={() => setEditing(e)}>
                              Edit
                            </Button>
                          </>
                        ) : null}
                        <Button asChild variant="ghost" size="sm">
                          <Link to="/employees/$employeeId" params={{ employeeId: e.id }}>
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>{filtered.length} employees</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {page + 1} of {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${editing.first_name} ${editing.last_name}` : "Edit employee"}
            </DialogTitle>
          </DialogHeader>
          {editing ? (
            <>
              <form
                id="edit-employee"
                key={editing.id}
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  updateEmployee.mutate({
                    record: editing,
                    form: Object.fromEntries(fd) as Record<string, string>,
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="designation">Designation</Label>
                  <Input
                    id="designation"
                    name="designation"
                    defaultValue={editing.designation ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="work_email">Work email</Label>
                  <Input
                    id="work_email"
                    name="work_email"
                    type="email"
                    defaultValue={editing.work_email ?? ""}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" name="phone" defaultValue={editing.phone ?? ""} />
                </div>
                <SelectField
                  name="employment_status"
                  label="Employment status"
                  value={editing.employment_status}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "probation", label: "Probation" },
                    { value: "notice_period", label: "Notice period" },
                    { value: "exited", label: "Exited" },
                  ]}
                />
                <SelectField
                  name="department_id"
                  label="Department"
                  value={editing.department_id ?? ""}
                  options={(departmentsQuery.data ?? []).map((d) => ({
                    value: d.id,
                    label: d.name,
                  }))}
                />
                <SelectField
                  name="location_id"
                  label="Location"
                  value={editing.location_id ?? ""}
                  options={(locationsQuery.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
                />
                <SelectField
                  name="manager_id"
                  label="Reporting manager"
                  value={editing.manager_id ?? ""}
                  options={employees
                    .filter((e) => e.id !== editing.id)
                    .map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}` }))}
                />
              </form>
              <DialogFooter>
                <Button type="submit" form="edit-employee" disabled={updateEmployee.isPending}>
                  {updateEmployee.isPending ? "Saving..." : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!terminating} onOpenChange={(o) => !o && setTerminating(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {terminating ? `Terminate ${terminating.first_name} ${terminating.last_name}` : ""}
            </DialogTitle>
          </DialogHeader>
          {terminating ? (
            <>
              <form
                id="terminate-employee"
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  terminateMutation.mutate({
                    employeeId: terminating.id,
                    effectiveDate: String(fd.get("effective_date") || ""),
                    reason: String(fd.get("reason") || ""),
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="effective_date">Effective date</Label>
                  <Input
                    id="effective_date"
                    name="effective_date"
                    type="date"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reason">Reason</Label>
                  <Textarea
                    id="reason"
                    name="reason"
                    placeholder="Reason for termination (visible on the career timeline)"
                    required
                  />
                </div>
              </form>
              <DialogFooter>
                <Button
                  type="submit"
                  form="terminate-employee"
                  variant="destructive"
                  disabled={terminateMutation.isPending}
                >
                  {terminateMutation.isPending ? "Terminating..." : "Terminate employment"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} />
    </div>
  );
}

function SelectField({
  name,
  label,
  options,
  value: initial = "",
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  value?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
