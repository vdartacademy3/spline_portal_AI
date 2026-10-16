import { Link, createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Bot,
  Briefcase,
  CalendarCheck,
  ClipboardList,
  FileLock2,
  Layers,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { PublicPage } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Spine AI — HR Intelligence & Workforce Management Platform" },
      {
        name: "description",
        content:
          "From HR chatbot to HR autopilot. Spine AI unifies employee records, attendance, leave, recruitment and a permission-aware AI copilot in one secure platform.",
      },
      { property: "og:title", content: "Spine AI — From HR Chatbot to HR Autopilot" },
      {
        property: "og:description",
        content:
          "AI that answers HR questions and prepares approved actions, inside strict role and data boundaries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const CAPABILITIES = [
  {
    icon: Bot,
    title: "AI HR Copilot",
    text: "Ask HR questions in plain language and get answers grounded in your own policies and workforce data.",
  },
  {
    icon: Users,
    title: "Employee 360",
    text: "One profile per person: employment, organisation, manager, documents, attendance, leave and performance.",
  },
  {
    icon: CalendarCheck,
    title: "Attendance & leave",
    text: "Live attendance reporting, leave requests, balances, approvals and automatic balance adjustment.",
  },
  {
    icon: Briefcase,
    title: "Recruitment / ATS",
    text: "Requisitions, publishing, a public careers site, applications, interviews, offers and hiring.",
  },
  {
    icon: ClipboardList,
    title: "Onboarding & helpdesk",
    text: "Assign onboarding tasks and run an HR helpdesk with ownership and comment history.",
  },
  {
    icon: BarChart3,
    title: "HR analytics",
    text: "Headcount, attrition, attendance and pipeline figures computed from live records, never mock data.",
  },
  {
    icon: Layers,
    title: "Organisation structure",
    text: "Organisation, legal entities, locations, departments and the reporting hierarchy behind every permission.",
  },
  {
    icon: FileLock2,
    title: "Documents",
    text: "Employee documents and resumes held in private storage, reachable only through short-lived signed links.",
  },
];

function Landing() {
  return (
    <PublicPage>
      <section className="border-b bg-gradient-to-b from-accent/40 to-background">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
            HR AI Intelligence &amp; Workforce Management
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            From HR chatbot to <span className="text-gradient-ai">HR autopilot</span> — AI that
            answers and acts.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Spine AI brings your people data, everyday HR workflows and recruitment into one system,
            with an AI copilot that works strictly inside each person&apos;s role and data
            boundaries.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/careers">Explore careers</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight">One connected HR platform</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Every module shares the same organisation structure, permissions and audit trail.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((c) => (
            <article key={c.title} className="surface-card p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <c.icon className="h-4.5 w-4.5" aria-hidden />
              </span>
              <h3 className="mt-3 text-base font-semibold">{c.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{c.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              An AI copilot that respects your boundaries
            </h2>
            <p className="mt-3 text-muted-foreground">
              The copilot reads your published HR policies and the workforce data the person asking
              is allowed to see. It explains where each answer came from, and anything consequential
              waits for a human decision.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {[
                "Ask HR questions in natural language",
                "Get workforce insights for your own team or organisation",
                "Summarise an employee record you are allowed to open",
                "Find the HR actions waiting on you",
                "Get recruitment support while hiring decisions stay with people",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="ai-surface p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Copilot
            </p>
            <div className="mt-4 space-y-4 text-sm">
              <p className="rounded-lg bg-background/70 p-3">
                &ldquo;What is my remaining leave balance?&rdquo;
              </p>
              <p className="rounded-lg bg-primary/10 p-3">
                Answered from the employee&apos;s own balance record — an employee never sees
                another person&apos;s data.
              </p>
              <p className="rounded-lg bg-background/70 p-3">
                &ldquo;Show my team&apos;s pending leave requests.&rdquo;
              </p>
              <p className="rounded-lg bg-primary/10 p-3">
                A manager sees only their reporting line; an HR admin sees the organisation.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="surface-card flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Hiring with Spine AI</h2>
            <p className="mt-1.5 text-muted-foreground">
              Published roles appear on a public careers site that anyone can browse and apply to —
              no account needed.
            </p>
          </div>
          <Button asChild size="lg">
            <Link to="/careers">Explore open positions</Link>
          </Button>
        </div>
      </section>

      <section className="border-t bg-card">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Security is part of the data model
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                title: "Role-based access control",
                text: "Five internal roles with an explicit permission catalogue enforced in the database, not just the menu.",
              },
              {
                icon: Layers,
                title: "DataScope",
                text: "Self, direct reports, department, location, legal entity, organisation and global visibility boundaries.",
              },
              {
                icon: FileLock2,
                title: "Organisation isolation",
                text: "Records carry their organisation, and access checks compare it on every read and write.",
              },
              {
                icon: ClipboardList,
                title: "Auditability",
                text: "Important changes are recorded with the acting user stamped by the database itself.",
              },
              {
                icon: Bot,
                title: "Secure AI actions",
                text: "The copilot cannot step outside the asker's permissions, and consequential actions need approval.",
              },
              {
                icon: FileLock2,
                title: "Protected HR data",
                text: "Documents and resumes stay in private storage behind short-lived signed links.",
              },
            ].map((s) => (
              <article key={s.title} className="rounded-xl border p-5">
                <s.icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
