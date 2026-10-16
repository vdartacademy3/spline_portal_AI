import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { MapPin, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { PublicPage } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listPublicJobs } from "@/lib/careers.functions";

export const Route = createFileRoute("/careers/")({
  head: () => ({
    meta: [
      { title: "Careers at Spine AI — Open Positions" },
      {
        name: "description",
        content:
          "Browse currently published openings at Spine AI and apply online — no account required.",
      },
      { property: "og:title", content: "Careers at Spine AI" },
      { property: "og:description", content: "See our open roles and apply in a few minutes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: () => listPublicJobs(),
  component: CareersPage,
});

function CareersPage() {
  const initial = Route.useLoaderData();
  const { data: jobs = [] } = useQuery({
    queryKey: ["public-jobs"],
    queryFn: () => listPublicJobs(),
    initialData: initial,
  });

  const [term, setTerm] = useState("");
  const [dept, setDept] = useState("all");
  const [mode, setMode] = useState("all");

  const departments = useMemo(
    () => [...new Set(jobs.map((j) => j.department).filter(Boolean))] as string[],
    [jobs],
  );
  const modes = useMemo(
    () => [...new Set(jobs.map((j) => j.work_mode).filter(Boolean))] as string[],
    [jobs],
  );

  const filtered = jobs.filter((j) => {
    const q = term.trim().toLowerCase();
    const matches =
      !q ||
      j.title.toLowerCase().includes(q) ||
      (j.department ?? "").toLowerCase().includes(q) ||
      (j.skills ?? []).some((s) => s.toLowerCase().includes(q));
    return (
      matches &&
      (dept === "all" || j.department === dept) &&
      (mode === "all" || j.work_mode === mode)
    );
  });

  return (
    <PublicPage>
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Open positions</h1>
        <p className="mt-2 text-muted-foreground">
          Every role listed here is currently open. Applying takes a few minutes and needs no
          account.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Search roles or skills"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              aria-label="Search roles"
            />
          </div>
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="sm:w-48">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Work mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any work mode</SelectItem>
              {modes.map((m) => (
                <SelectItem key={m} value={m} className="capitalize">
                  {m.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-8 space-y-3">
          {filtered.length === 0 ? (
            <p className="surface-card p-10 text-center text-sm text-muted-foreground">
              {jobs.length === 0
                ? "There are no published openings at the moment. Please check back soon."
                : "No roles match your search."}
            </p>
          ) : (
            filtered.map((job) => (
              <article
                key={job.slug}
                className="surface-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold">{job.title}</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    {job.department ? <span>{job.department}</span> : null}
                    {job.city || job.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" aria-hidden />
                        {[job.city, job.country].filter(Boolean).join(", ") || job.location}
                      </span>
                    ) : null}
                    <span className="capitalize">{job.employment_type?.replace(/_/g, " ")}</span>
                    {job.work_mode ? (
                      <span className="capitalize">{job.work_mode.replace(/_/g, " ")}</span>
                    ) : null}
                  </p>
                  {job.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {job.description}
                    </p>
                  ) : null}
                </div>
                <Button asChild>
                  <Link to="/careers/$slug" params={{ slug: job.slug }}>
                    View job
                  </Link>
                </Button>
              </article>
            ))
          )}
        </div>
      </div>
    </PublicPage>
  );
}
