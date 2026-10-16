import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatCard } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useAuth } from "@/hooks/useAuth";
import {
  changeUserAccess,
  createUserAccount,
  listUserAccess,
  setUserStatus,
  type UserAccessRow,
} from "@/lib/admin.functions";
import {
  ALL_SCOPES,
  ROLE_LABEL,
  SCOPE_LABEL,
  canAccess,
  type AppRole,
  type DataScope,
} from "@/lib/rbac";

export const Route = createFileRoute("/_app/admin/users")({
  head: () => ({
    meta: [
      { title: "User Access — Spine AI" },
      {
        name: "description",
        content:
          "Administer who can sign in to Spine AI, the role they hold, the data scope they are granted and their account status.",
      },
      { property: "og:title", content: "User Access — Spine AI" },
      {
        property: "og:description",
        content: "Roles, data scope and account status administration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UserAccessPage,
});

const ROLES: AppRole[] = ["super_admin", "hr_admin", "hr_staff", "manager", "employee"];
const ALL = "all";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function UserAccessPage() {
  const { roles, permissions } = useAuth();
  const queryClient = useQueryClient();
  const fetchUsers = useServerFn(listUserAccess);
  const createUser = useServerFn(createUserAccount);
  const changeAccess = useServerFn(changeUserAccess);
  const changeStatus = useServerFn(setUserStatus);

  const superAdmin = roles.includes("super_admin");
  const [roleFilter, setRoleFilter] = useState<string>(ALL);
  const [departmentFilter, setDepartmentFilter] = useState<string>(ALL);
  const [locationFilter, setLocationFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<UserAccessRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "employee" as AppRole,
    scope: "SELF" as DataScope,
  });

  const query = useQuery({
    queryKey: ["user-access"],
    enabled: superAdmin,
    queryFn: () => fetchUsers({}),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["user-access"] });

  const create = useMutation({
    mutationFn: () => createUser({ data: form }),
    onSuccess: () => {
      toast.success("User created");
      setCreateOpen(false);
      setForm({ fullName: "", email: "", password: "", role: "employee", scope: "SELF" });
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The user could not be created."),
  });

  const access = useMutation({
    mutationFn: (input: { userId: string; role: AppRole; scope: DataScope }) =>
      changeAccess({ data: input }),
    onSuccess: () => {
      toast.success("Access updated");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Access could not be changed."),
  });

  const status = useMutation({
    mutationFn: (input: { userId: string; active: boolean }) => changeStatus({ data: input }),
    onSuccess: () => {
      toast.success("Account status updated");
      invalidate();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The status could not be changed."),
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.department).filter(Boolean))] as string[],
    [rows],
  );
  const locations = useMemo(
    () => [...new Set(rows.map((r) => r.location).filter(Boolean))] as string[],
    [rows],
  );

  const filtered = rows.filter((r) => {
    if (roleFilter !== ALL && r.role !== roleFilter) return false;
    if (departmentFilter !== ALL && r.department !== departmentFilter) return false;
    if (locationFilter !== ALL && r.location !== locationFilter) return false;
    if (statusFilter !== ALL && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.fullName} ${r.email} ${r.employeeCode ?? ""}`.toLowerCase().includes(q))
        return false;
    }
    return true;
  });

  if (!canAccess("users", roles, permissions) || !superAdmin)
    return <NoPermissionState what="user and access management" />;
  if (query.isLoading) return <LoadingState rows={6} />;
  if (query.isError) return <ErrorState message="Unable to load user access." />;

  return (
    <>
      <PageHeader
        title="User Access"
        description="Only a Super Admin can manage global access. Every change here is written to the audit log."
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>Create user</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create user</DialogTitle>
                <DialogDescription>
                  The person can sign in immediately with the password you set here.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cu-name">Full name</Label>
                  <Input
                    id="cu-name"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cu-email">Work email</Label>
                  <Input
                    id="cu-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cu-pass">Temporary password</Label>
                  <Input
                    id="cu-pass"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select
                      value={form.role}
                      onValueChange={(v) => setForm({ ...form, role: v as AppRole })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Data scope</Label>
                    <Select
                      value={form.scope}
                      onValueChange={(v) => setForm({ ...form, scope: v as DataScope })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_SCOPES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {SCOPE_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={create.isPending}>
                  {create.isPending ? "Creating..." : "Create user"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={rows.length} />
        <StatCard label="Active" value={rows.filter((r) => r.status === "active").length} />
        <StatCard
          label="Disabled"
          value={rows.filter((r) => r.status !== "active").length}
          tone="warning"
        />
        <StatCard label="Without a role" value={rows.filter((r) => !r.role).length} />
      </div>

      <SectionCard title="Filters" className="mt-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Input
            placeholder="Search name, email or employee ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={locationFilter} onValueChange={setLocationFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All locations</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SectionCard>

      <SectionCard title={`Users (${filtered.length})`} className="mt-4">
        {filtered.length === 0 ? (
          <EmptyState title="No users match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Work email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden lg:table-cell">Employee ID</TableHead>
                  <TableHead className="hidden xl:table-cell">Department</TableHead>
                  <TableHead className="hidden xl:table-cell">Location</TableHead>
                  <TableHead className="hidden xl:table-cell">Manager</TableHead>
                  <TableHead>Data scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Last login</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.userId}>
                    <TableCell className="font-medium">{r.fullName}</TableCell>
                    <TableCell className="hidden md:table-cell">{r.email || "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={r.role ?? "employee"}
                        onValueChange={(v) =>
                          access.mutate({
                            userId: r.userId,
                            role: v as AppRole,
                            scope: r.scope ?? "SELF",
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{r.employeeCode ?? "—"}</TableCell>
                    <TableCell className="hidden xl:table-cell">{r.department ?? "—"}</TableCell>
                    <TableCell className="hidden xl:table-cell">{r.location ?? "—"}</TableCell>
                    <TableCell className="hidden xl:table-cell">{r.manager ?? "—"}</TableCell>
                    <TableCell>
                      <Select
                        value={r.scope ?? "SELF"}
                        onValueChange={(v) =>
                          access.mutate({
                            userId: r.userId,
                            role: r.role ?? "employee",
                            scope: v as DataScope,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_SCOPES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {SCOPE_LABEL[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "active" ? "secondary" : "destructive"}>
                        {r.status === "active" ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {formatDate(r.lastLogin)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            status.mutate({ userId: r.userId, active: r.status !== "active" })
                          }
                        >
                          {r.status === "active" ? "Disable" : "Reactivate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.fullName}</DialogTitle>
            <DialogDescription>{detail?.email}</DialogDescription>
          </DialogHeader>
          {detail ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Role</dt>
                <dd>{detail.role ? ROLE_LABEL[detail.role] : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Data scope</dt>
                <dd>{detail.scope ? SCOPE_LABEL[detail.scope] : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Employee ID</dt>
                <dd>{detail.employeeCode ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Department</dt>
                <dd>{detail.department ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Location</dt>
                <dd>{detail.location ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Manager</dt>
                <dd>{detail.manager ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{detail.status}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last login</dt>
                <dd>{formatDate(detail.lastLogin)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDate(detail.createdAt)}</dd>
              </div>
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
