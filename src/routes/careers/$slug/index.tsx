import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { Check, Copy, MapPin } from "lucide-react";
import { useState } from "react";

import { PublicPage } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { getPublicJob } from "@/lib/careers.functions";

export const Route = createFileRoute("/careers/$slug/")({
  loader: async ({ params }) => {
    const job = await getPublicJob({ data: { slug: params.slug } });
    if (!job) throw notFound();
    return job;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Open role"} — Spine AI Careers` },
      {
        name: "description",
        content:
          loaderData?.description?.slice(0, 155) ??
          "An open position at Spine AI. Read the details and apply online.",
      },
      { property: "og:title", content: `${loaderData?.title ?? "Open role"} — Spine AI Careers` },
      {
        property: "og:description",
        content:
          loaderData?.description?.slice(0, 155) ?? "Apply for this open position at Spine AI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  notFoundComponent: () => (
    <PublicPage>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">This position is not open</h1>
        <p className="mt-2 text-muted-foreground">
          The role you followed is no longer published. Browse our current openings instead.
        </p>
        <Button asChild className="mt-6">
          <Link to="/careers">View open positions</Link>
        </Button>
      </div>
    </PublicPage>
  ),
  errorComponent: () => (
    <PublicPage>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">We couldn&apos;t load this role</h1>
        <p className="mt-2 text-muted-foreground">Please try again in a moment.</p>
      </div>
    </PublicPage>
  ),
  component: JobDetail,
});

function Section({ title, body }: { title: string; body: string | null }) {
  if (!body) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </section>
  );
}

function JobDetail() {
  const job = Route.useLoaderData();
  const [copied, setCopied] = useState(false);

  return (
    <PublicPage>
      <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <Link to="/careers" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; All open positions
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{job.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
          {job.experience_min !== null ? (
            <span>
              {job.experience_min}
              {job.experience_max ? `–${job.experience_max}` : "+"} yrs experience
            </span>
          ) : null}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/careers/$slug/apply" params={{ slug: job.slug }}>
              Apply now
            </Link>
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? (
              <Check className="mr-2 h-4 w-4" aria-hidden />
            ) : (
              <Copy className="mr-2 h-4 w-4" aria-hidden />
            )}
            {copied ? "Link copied" : "Copy job link"}
          </Button>
        </div>

        <Section title="About the role" body={job.description} />
        <Section title="What you will do" body={job.responsibilities} />
        <Section title="What we are looking for" body={job.requirements} />
        <Section title="Qualifications" body={job.qualifications} />

        {job.skills?.length ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Skills</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {job.skills.map((s) => (
                <li key={s} className="rounded-full border bg-muted px-3 py-1 text-xs">
                  {s}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="surface-card mt-12 flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Ready to apply? It takes a few minutes.</p>
          <Button asChild>
            <Link to="/careers/$slug/apply" params={{ slug: job.slug }}>
              Apply now
            </Link>
          </Button>
        </div>
      </article>
    </PublicPage>
  );
}
