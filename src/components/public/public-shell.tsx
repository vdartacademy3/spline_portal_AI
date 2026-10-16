import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          Spine AI
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link to="/" className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground">
            Home
          </Link>
          <Link
            to="/careers"
            className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground"
          >
            Careers
          </Link>
          <Button asChild size="sm" className="ml-2">
            <Link to="/auth">Sign in</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="font-medium text-foreground">
          Spine AI — HR Intelligence &amp; Workforce Management
        </p>
        <nav className="flex gap-5">
          <Link to="/careers" className="hover:text-foreground">
            Careers
          </Link>
          <Link to="/auth" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
        <p>&copy; {new Date().getFullYear()} Spine AI</p>
      </div>
    </footer>
  );
}

export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
