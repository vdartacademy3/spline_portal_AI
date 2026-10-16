import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { PageHeader, SectionCard } from "@/components/hr/primitives";
import { ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { setRolePermission } from "@/lib/admin.functions";
import { ROLE_LABEL, type AppRole } from "@/lib/rbac";

export const Route = createFileRoute("/_app/admin/roles")({
  head: () => ({
    meta: [
      { title: "Roles & Permissions — Spine AI" },
      {
        name: "description",
        content:
          "Decide exactly which permissions each role holds. Changes apply to data access, not only to menus.",
      },
      { property: "og:title", content: "Roles & Permissions — Spine AI" },
      { property: "og:description", content: "Permission matrix for every Spine AI role." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RolesPage,
});

const EDITABLE_ROLES: AppRole[] = ["hr_admin", "hr_staff", "manager", "employee"];

function RolesPage() {
  const { roles } = useAuth();
  const queryClient = useQueryClient();
  const updatePermission = useServerFn(setRolePermission);

  const query = useQuery({
    queryKey: ["permission-matrix"],
    enabled: roles.includes("super_admin"),
    queryFn: async () => {
      const [{ data: permissions, error: e1 }, { data: assigned, error: e2 }] = await Promise.all([
        supabase.from("permissions").select("code, label, category, sensitive").order("category"),
        supabase.from("role_permissions").select("role, permission_code"),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { permissions: permissions ?? [], assigned: assigned ?? [] };
    },
  });

  const toggle = useMutation({
    mutationFn: (input: { role: AppRole; code: string; enabled: boolean }) =>
      updatePermission({ data: input }),
    onSuccess: () => {
      toast.success("Permission updated");
      void queryClient.invalidateQueries({ queryKey: ["permission-matrix"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "The permission could not be changed."),
  });

  if (!roles.includes("super_admin")) return <NoPermissionState what="roles and permissions" />;
  if (query.isLoading) return <LoadingState rows={6} />;
  if (query.isError) return <ErrorState message="Unable to load the permission matrix." />;

  const { permissions, assigned } = query.data!;
  const has = (role: AppRole, code: string) =>
    assigned.some((a) => a.role === role && a.permission_code === code);

  const categories = [...new Set(permissions.map((p) => p.category))];

  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="Permissions are enforced in the database. Removing one here blocks the data, not just the menu item."
      />

      {categories.map((category) => (
        <SectionCard key={category} title={category} className="mt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">Permission</TableHead>
                  <TableHead>Super Admin</TableHead>
                  {EDITABLE_ROLES.map((r) => (
                    <TableHead key={r}>{ROLE_LABEL[r]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions
                  .filter((p) => p.category === category)
                  .map((p) => (
                    <TableRow key={p.code}>
                      <TableCell className="font-medium">
                        {p.label}
                        {p.sensitive ? (
                          <Badge variant="destructive" className="ml-2">
                            Sensitive
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Checkbox checked disabled aria-label="Super Admin always allowed" />
                      </TableCell>
                      {EDITABLE_ROLES.map((r) => (
                        <TableCell key={r}>
                          <Checkbox
                            checked={has(r, p.code)}
                            aria-label={`${ROLE_LABEL[r]} — ${p.label}`}
                            onCheckedChange={(v) =>
                              toggle.mutate({ role: r, code: p.code, enabled: Boolean(v) })
                            }
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      ))}
    </>
  );
}
