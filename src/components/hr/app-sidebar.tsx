import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Gauge,
  LifeBuoy,
  ListChecks,
  LogOut,
  Settings,
  KeyRound,
  Cpu,
  ShieldCheck,
  Sparkles,
  Target,
  UserRoundCog,
  Users,
  UsersRound,
  Wallet,
  Workflow,
  BookOpen,
  BadgeCheck,
  Banknote,
  GraduationCap,
  Laptop,
  Mail,
} from "lucide-react";
import type { ComponentType } from "react";

import { canAccess, type AppRole, type ModuleKey } from "@/lib/rbac";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  module: ModuleKey;
  /**
   * The route guard for this page requires super_admin even though its module is
   * open to hr_admin. The link must not be advertised to roles the route denies.
   */
  superAdminOnly?: true;
};

const MAIN: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: Gauge, module: "dashboard" },
  { to: "/copilot", label: "AI Copilot", icon: Sparkles, module: "copilot" },
  { to: "/employees", label: "Employees", icon: Users, module: "employees" },
  { to: "/recruitment", label: "Recruitment", icon: UsersRound, module: "recruitment" },
  { to: "/onboarding", label: "Onboarding", icon: Workflow, module: "onboarding" },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck, module: "attendance" },
  { to: "/shifts", label: "Shifts", icon: CalendarClock, module: "shifts" },
  { to: "/leave", label: "Leave", icon: CalendarDays, module: "leave" },
  { to: "/performance", label: "Performance", icon: Target, module: "performance" },
  { to: "/documents", label: "Documents", icon: FileText, module: "documents" },
  { to: "/helpdesk", label: "HR Helpdesk", icon: LifeBuoy, module: "helpdesk" },
  { to: "/offboarding", label: "Offboarding", icon: LogOut, module: "offboarding" },
  { to: "/expenses", label: "Expenses", icon: Wallet, module: "expenses" },
  { to: "/letters", label: "Letters", icon: Mail, module: "letters" },
  { to: "/assets", label: "Assets", icon: Laptop, module: "assets" },
  { to: "/training", label: "Training", icon: GraduationCap, module: "training" },
  { to: "/compliance", label: "Compliance", icon: BadgeCheck, module: "compliance" },
  { to: "/payroll", label: "Payroll", icon: Banknote, module: "payroll" },
  { to: "/ai-actions", label: "AI Actions", icon: ListChecks, module: "ai-actions" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, module: "analytics" },
];

const ADMIN: NavItem[] = [
  { to: "/admin/organization", label: "Organization", icon: Building2, module: "organization" },
  {
    to: "/admin/users",
    label: "User Access",
    icon: UserRoundCog,
    module: "users",
    superAdminOnly: true,
  },
  {
    to: "/admin/roles",
    label: "Roles & Permissions",
    icon: KeyRound,
    module: "users",
    superAdminOnly: true,
  },
  {
    to: "/admin/ai",
    label: "AI Configuration",
    icon: Cpu,
    module: "knowledge",
    superAdminOnly: true,
  },
  { to: "/admin/knowledge", label: "Knowledge Base", icon: BookOpen, module: "knowledge" },
  { to: "/admin/audit", label: "Audit Logs", icon: ShieldCheck, module: "audit" },
  { to: "/settings", label: "Settings", icon: Settings, module: "settings" },
];

export function SidebarNav({
  roles,
  permissions = [],
  onNavigate,
}: {
  roles: AppRole[];
  permissions?: string[];
  onNavigate?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const superAdmin = roles.includes("super_admin");
  const main = MAIN.filter((i) => canAccess(i.module, roles, permissions));
  const admin = ADMIN.filter(
    (i) => canAccess(i.module, roles, permissions) && (!i.superAdminOnly || superAdmin),
  );

  const renderItem = (item: NavItem) => {
    const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
    const Icon = item.icon;
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
        aria-current={active ? "page" : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto p-3" aria-label="Main">
      <div className="flex items-center gap-2 px-2 pt-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Sparkles className="h-5 w-5" aria-hidden />
        </span>
        <div className="leading-tight">
          <p className="font-semibold text-sidebar-accent-foreground">Spine AI</p>
          <p className="text-[11px] text-sidebar-foreground/70">
            {superAdmin ? "Super Admin Portal" : "HR Intelligence"}
          </p>
        </div>
      </div>

      <div className="space-y-1">{main.map(renderItem)}</div>

      {admin.length ? (
        <div className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
            {superAdmin ? "Super Admin Portal" : "Administration"}
          </p>
          {admin.map(renderItem)}
        </div>
      ) : null}
    </nav>
  );
}
