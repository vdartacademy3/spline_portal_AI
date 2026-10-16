import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bell, HelpCircle, LogOut, Menu, Sparkles, User } from "lucide-react";
import { useEffect, useState } from "react";

import { SidebarNav } from "@/components/hr/app-sidebar";
import { GlobalSearchProvider } from "@/components/hr/global-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/lib/rbac";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { loading, session, roles, permissions, role, fullName, employee, signOut } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", session?.user.id],
    enabled: Boolean(session?.user.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, read, created_at, link")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data;
    },
  });

  const unread = notifications.filter((n) => !n.read).length;

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading your workspace...</p>
      </div>
    );
  }

  const initials = (fullName || "U")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 bg-sidebar lg:block">
        <SidebarNav roles={roles} permissions={permissions} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-card/90 px-3 backdrop-blur sm:px-5">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarNav
                roles={roles}
                permissions={permissions}
                onNavigate={() => setMobileOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <Button
            variant="default"
            className="hidden gap-2 sm:inline-flex"
            onClick={() => navigate({ to: "/copilot" })}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Ask Spine AI
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                <Bell className="h-5 w-5" />
                {unread > 0 ? (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <p className="text-sm font-semibold">Notifications</p>
                {unread > 0 ? <Badge variant="secondary">{unread} new</Badge> : null}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    You have no notifications.
                  </p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      className="block w-full border-b px-4 py-3 text-left last:border-0 hover:bg-accent"
                      onClick={async () => {
                        await supabase.from("notifications").update({ read: true }).eq("id", n.id);
                        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
                        if (n.link) void navigate({ to: n.link as "/dashboard" });
                      }}
                    >
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.body ? <p className="text-xs text-muted-foreground">{n.body}</p> : null}
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Help"
            onClick={() => navigate({ to: "/helpdesk" })}
          >
            <HelpCircle className="h-5 w-5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                aria-label="Account menu"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{fullName}</p>
                <p className="text-xs font-normal text-muted-foreground">{ROLE_LABEL[role]}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {employee ? (
                <DropdownMenuItem onClick={() => navigate({ to: `/employees/${employee.id}` })}>
                  <User className="mr-2 h-4 w-4" /> My profile
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  await signOut();
                  void navigate({ to: "/auth", replace: true });
                }}
              >
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <GlobalSearchProvider>
            <Outlet />
          </GlobalSearchProvider>
        </main>
      </div>
    </div>
  );
}
