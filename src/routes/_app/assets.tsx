import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Laptop, Plus, Undo2 } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/assets")({
  head: () => ({
    meta: [
      { title: "Assets — Spine AI" },
      {
        name: "description",
        content: "Track company assets, assignments and returns across your workforce.",
      },
      { property: "og:title", content: "Assets — Spine AI" },
      { property: "og:description", content: "Company asset inventory and assignments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssetsPage,
});

const ASSET_CATEGORIES = [
  "laptop",
  "desktop",
  "monitor",
  "mobile",
  "tablet",
  "headset",
  "key",
  "badge",
  "vehicle",
  "equipment",
  "furniture",
  "other",
];

function AssetsPage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const [newOpen, setNewOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const assetsQuery = useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_assets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const assignmentsQuery = useQuery({
    queryKey: ["asset-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_asset_assignments")
        .select("*")
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createAsset = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { data, error } = await supabase
        .from("company_assets")
        .insert({
          name: String(form["name"]),
          category: String(form["category"] ?? "equipment"),
          serial_number: String(form["serial_number"] ?? "") || null,
          asset_tag: String(form["asset_tag"] ?? "") || null,
          purchase_date: String(form["purchase_date"] || "") || null,
          purchase_value: Number(form["purchase_value"]) || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "asset.created",
        entity: "company_assets",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Asset added to inventory");
      setNewOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The asset could not be created."),
  });

  const assign = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const assetId = assignFor;
      if (!assetId) throw new Error("No asset selected.");
      const { data, error } = await supabase
        .from("employee_asset_assignments")
        .insert({
          asset_id: assetId,
          employee_id: String(form["employee_id"]),
          status: "active",
          assigned_by: user?.id ?? null,
          expected_return: String(form["expected_return"] || "") || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "asset.assigned",
        entity: "employee_asset_assignments",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Asset assigned");
      setAssignFor(null);
      void queryClient.invalidateQueries({ queryKey: ["asset-assignments"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The asset could not be assigned."),
  });

  const returnAsset = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase
        .from("employee_asset_assignments")
        .update({
          status: "returned",
          returned_at: new Date().toISOString(),
          return_note: note || null,
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "asset.returned",
        entity: "employee_asset_assignments",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Asset returned");
      void queryClient.invalidateQueries({ queryKey: ["asset-assignments"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The return could not be recorded."),
  });

  const retire = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("company_assets")
        .update({ status: "retired" })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "asset.retired",
        entity: "company_assets",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Asset retired");
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["asset-assignments"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The asset could not be retired."),
  });

  if (!canAccess("assets", roles, permissions))
    return <NoPermissionState what="company asset information" />;
  if (assetsQuery.isLoading) return <LoadingState rows={6} />;
  if (assetsQuery.isError) return <ErrorState message="Unable to load assets." />;

  const names = nameMap(employeesQuery.data ?? []);
  const assets = assetsQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const mineAssignments = employee ? assignments.filter((a) => a.employee_id === employee.id) : [];
  const visibleAssignments = hr ? assignments : mineAssignments;
  const inUse = assets.filter((a) => a.status === "assigned").length;
  const available = assets.filter((a) => a.status === "available").length;
  const byAssetId = new Map(
    assignments.filter((a) => a.status === "active").map((a) => [a.asset_id, a]),
  );
  const activeAssignmentIds = new Set(
    assignments.filter((a) => a.status === "active").map((a) => a.asset_id),
  );

  return (
    <>
      <PageHeader
        title="Assets"
        description="Track company assets, their condition and who holds what."
        actions={
          hr ? (
            <Dialog open={newOpen} onOpenChange={setNewOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Add asset
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add company asset</DialogTitle>
                </DialogHeader>
                <form
                  id="asset-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createAsset.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" name="name" required placeholder="MacBook Pro 14" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <AssetCategorySelect />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="serial_number">Serial number</Label>
                      <Input id="serial_number" name="serial_number" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="asset_tag">Asset tag</Label>
                      <Input id="asset_tag" name="asset_tag" placeholder="AST-0001" />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="purchase_date">Purchased</Label>
                      <Input id="purchase_date" name="purchase_date" type="date" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="purchase_value">Purchase value</Label>
                      <Input
                        id="purchase_value"
                        name="purchase_value"
                        type="number"
                        min={0}
                        step="0.01"
                      />
                    </div>
                  </div>
                </form>
                <DialogFooter>
                  <Button type="submit" form="asset-form" disabled={createAsset.isPending}>
                    {createAsset.isPending ? "Adding..." : "Add asset"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total assets"
          value={assets.length}
          icon={<Laptop className="h-4 w-4" />}
        />
        <StatCard label="In use" value={inUse} tone="warning" />
        <StatCard label="Available" value={available} tone="success" />
        <StatCard label="Active assignments" value={activeAssignmentIds.size} />
      </div>

      <SectionCard title={hr ? "Assets" : "My assigned assets"} className="mt-6">
        {assets.length === 0 ? (
          <EmptyState title="No assets registered yet." />
        ) : (
          <ul className="space-y-3">
            {assets.map((a) => {
              const assignment = byAssetId.get(a.id);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="font-medium">{a.name}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground capitalize">
                      {a.category.replace("_", " ")}
                      {a.serial_number ? ` · SN ${a.serial_number}` : ""}
                      {a.asset_tag ? ` · ${a.asset_tag}` : ""}
                      {a.purchase_date ? ` · purchased ${a.purchase_date}` : ""}
                    </p>
                    {assignment ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Currently with {names.get(assignment.employee_id) ?? "—"} since{" "}
                        {new Date(assignment.assigned_at).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {hr && a.status !== "retired" && a.status !== "assigned" ? (
                      <Button size="sm" onClick={() => setAssignFor(a.id)}>
                        Assign
                      </Button>
                    ) : null}
                    {hr && a.status !== "retired" && !assignment ? (
                      <Button size="sm" variant="outline" onClick={() => retire.mutate(a.id)}>
                        Retire
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={hr ? "Assignments" : "My assignments"} className="mt-6">
        {visibleAssignments.length === 0 ? (
          <EmptyState title="No assignments yet." />
        ) : (
          <ul className="space-y-3">
            {visibleAssignments.map((s) => {
              const asset = assets.find((a) => a.id === s.asset_id);
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="font-medium">{asset?.name ?? "Asset"}</p>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {names.get(s.employee_id) ?? "—"} · assigned{" "}
                      {new Date(s.assigned_at).toLocaleDateString()}
                      {s.expected_return ? ` · due ${s.expected_return}` : ""}
                    </p>
                    {s.return_note ? (
                      <p className="mt-1 text-xs text-muted-foreground">{s.return_note}</p>
                    ) : null}
                  </div>
                  {hr && s.status === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const note = prompt("Return note (optional):");
                        void returnAsset.mutate({ id: s.id, note: note ?? "" });
                      }}
                    >
                      <Undo2 className="mr-1.5 h-4 w-4" /> Return
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <Dialog
        open={assignFor !== null}
        onOpenChange={(o) => {
          if (!o) setAssignFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign asset</DialogTitle>
          </DialogHeader>
          <form
            id="assign-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              assign.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select name="employee_id">
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
            <p className="text-xs text-muted-foreground">
              Assigning:{" "}
              {assignFor ? (assets.find((a) => a.id === assignFor)?.name ?? "Asset") : "—"}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="expected_return">Expected return date</Label>
              <Input id="expected_return" name="expected_return" type="date" />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="assign-form" disabled={assign.isPending}>
              {assign.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AssetCategorySelect() {
  const [value, setValue] = useState(ASSET_CATEGORIES[0]!);
  return (
    <>
      <input type="hidden" name="category" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASSET_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {c.replace("_", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
