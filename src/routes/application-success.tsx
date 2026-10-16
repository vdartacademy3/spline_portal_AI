import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";

import { PublicPage } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/application-success")({
  head: () => ({
    meta: [
      { title: "Application received — Spine AI Careers" },
      {
        name: "description",
        content: "Your application has been received by the Spine AI hiring team.",
      },
      { property: "og:title", content: "Application received — Spine AI" },
      {
        property: "og:description",
        content: "Thank you for applying. Our team will review your application.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Success,
});

function Success() {
  return (
    <PublicPage>
      <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
        <CheckCircle2 className="mx-auto h-12 w-12 text-success" aria-hidden />
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Application received</h1>
        <p className="mt-3 text-muted-foreground">
          Thank you for applying. Our hiring team has your details and will be in touch by email if
          your background matches the role.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button asChild>
            <Link to="/careers">Browse other roles</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </PublicPage>
  );
}
