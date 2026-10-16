import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, MapPin, Network } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatCard } from "@/components/hr/primitives";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  fetchDepartments,
  fetchEmployees,
  fetchLocations,
  fetchOrganization,
  logAudit,
  nameMap,
} from "@/lib/hr-queries";
import { canAccess } from "@/lib/rbac";

export const Route = createFileRoute("/_app/admin/organization")({
  head: () => ({
    meta: [
      { title: "Organization — Spine AI" },
      {
        name: "description",
        content:
          "Legal entities, locations, departments and reporting structure for your organization.",
      },
      { property: "og:title", content: "Organization — Spine AI" },
      {
        property: "og:description",
        content: "Entities, locations, departments and reporting lines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OrganizationPage,
});

function OrganizationPage() {
  const { roles, permissions, user } = useAuth();
  const queryClient = useQueryClient();
  const organizationQuery = useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });

  const entitiesQuery = useQuery({
    queryKey: ["legal-entities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("id, name, code, registration_number")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

  const createEntity = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const organizationId = organizationQuery.data?.id;
      if (!organizationId) throw new Error("no-organization");
      const { data, error } = await supabase
        .from("legal_entities")
        .insert({
          organization_id: organizationId,
          name: form["name"]!,
          code: form["code"]!,
          registration_number: form["registration_number"] || null,
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "legal_entity.created",
        entity: "legal_entities",
        entityId: data.id,
        next: form,
      });
    },
    onSuccess: () => {
      toast.success("Legal entity created");
      void queryClient.invalidateQueries({ queryKey: ["legal-entities"] });
    },
    onError: () => toast.error("The legal entity could not be created."),
  });

  const createLocation = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const organizationId = organizationQuery.data?.id;
      if (!organizationId) throw new Error("no-organization");
      const { data, error } = await supabase
        .from("locations")
        .insert({
          organization_id: organizationId,
          name: form["name"]!,
          city: form["city"] || null,
          country: form["country"] || null,
          address: form["address"] || null,
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "location.created",
        entity: "locations",
        entityId: data.id,
        next: form,
      });
    },
    onSuccess: () => {
      toast.success("Location created");
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: () => toast.error("The location could not be created."),
  });

  const createDepartment = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const organizationId = organizationQuery.data?.id;
      if (!organizationId) throw new Error("no-organization");
      const { data, error } = await supabase
        .from("departments")
        .insert({
          organization_id: organizationId,
          name: form["name"]!,
          code: form["code"]!,
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "department.created",
        entity: "departments",
        entityId: data.id,
        next: form,
      });
    },
    onSuccess: () => {
      toast.success("Department created");
      void queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
    onError: () => toast.error("The department could not be created."),
  });

  if (!canAccess("organization", roles, permissions))
    return <NoPermissionState what="organization settings" />;
  if (entitiesQuery.isLoading || employeesQuery.isLoading) return <LoadingState rows={6} />;
  if (entitiesQuery.isError)
    return <ErrorState message="Unable to load the organization structure." />;

  const employees = employeesQuery.data ?? [];
  const names = nameMap(employees);
  const departments = departmentsQuery.data ?? [];
  const locations = locationsQuery.data ?? [];
  const entities = entitiesQuery.data ?? [];

  const managers = employees.filter((e) => employees.some((o) => o.manager_id === e.id));

  return (
    <>
      <PageHeader
        title="Organization"
        description="Legal entities, locations, departments and reporting structure."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Legal entities"
          value={entities.length}
          icon={<Building2 className="h-4 w-4" />}
        />
        <StatCard
          label="Locations"
          value={locations.length}
          icon={<MapPin className="h-4 w-4" />}
        />
        <StatCard
          label="Departments"
          value={departments.length}
          icon={<Network className="h-4 w-4" />}
        />
        <StatCard label="People managers" value={managers.length} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Legal entities"
          actions={
            <CreateDialog
              title="New legal entity"
              trigger="Add"
              pending={createEntity.isPending}
              onSubmit={(form) => createEntity.mutate(form)}
            >
              <Field name="name" label="Name" required />
              <Field name="code" label="Code" required />
              <Field name="registration_number" label="Registration number" />
            </CreateDialog>
          }
        >
          {entities.length === 0 ? (
            <EmptyState title="No entities configured." />
          ) : (
            <ul className="space-y-2">
              {entities.map((e) => (
                <li key={e.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{e.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.code} · {e.registration_number ?? "no registration number"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Locations"
          actions={
            <CreateDialog
              title="New location"
              trigger="Add"
              pending={createLocation.isPending}
              onSubmit={(form) => createLocation.mutate(form)}
            >
              <Field name="name" label="Name" required />
              <Field name="city" label="City" />
              <Field name="country" label="Country" />
              <Field name="address" label="Address" />
            </CreateDialog>
          }
        >
          {locations.length === 0 ? (
            <EmptyState title="No locations configured." />
          ) : (
            <ul className="space-y-2">
              {locations.map((l) => (
                <li key={l.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[l.city, l.country].filter(Boolean).join(", ") || "—"} ·{" "}
                    {employees.filter((e) => e.location_id === l.id).length} people
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Departments"
          actions={
            <CreateDialog
              title="New department"
              trigger="Add"
              pending={createDepartment.isPending}
              onSubmit={(form) => createDepartment.mutate(form)}
            >
              <Field name="name" label="Name" required />
              <Field name="code" label="Code" required />
            </CreateDialog>
          }
        >
          {departments.length === 0 ? (
            <EmptyState title="No departments configured." />
          ) : (
            <ul className="space-y-2">
              {departments.map((d) => (
                <li key={d.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {employees.filter((e) => e.department_id === d.id).length} people
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Reporting structure" className="mt-4">
        {managers.length === 0 ? (
          <EmptyState title="No reporting lines recorded." />
        ) : (
          <ul className="space-y-4">
            {managers.map((m) => (
              <li key={m.id}>
                <p className="text-sm font-medium">
                  {m.first_name} {m.last_name}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {m.designation}
                  </span>
                </p>
                <ul className="mt-2 space-y-1 border-l pl-4">
                  {employees
                    .filter((e) => e.manager_id === m.id)
                    .map((r) => (
                      <li key={r.id} className="text-sm text-muted-foreground">
                        {names.get(r.id)} — {r.designation ?? "—"}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}

function Field({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required={required} />
    </div>
  );
}

function CreateDialog({
  title,
  trigger,
  pending,
  onSubmit,
  children,
}: {
  title: string;
  trigger: string;
  pending: boolean;
  onSubmit: (form: Record<string, string>) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            onSubmit(Object.fromEntries(fd) as Record<string, string>);
            setOpen(false);
          }}
        >
          {children}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
