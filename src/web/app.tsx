import { createRootRoute, createRoute, Outlet, Link } from "@tanstack/react-router";
import { UserButton } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Dashboard, SheriffSales, LegalNotices } from "./pages";
import { AdminPage } from "./admin/AdminPage";
import { ShieldCheck } from "lucide-react";

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="block rounded-lg px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white [&.active]:bg-accent [&.active]:text-white [&.active]:font-semibold"
    >
      {label}
    </Link>
  );
}

function AdminNavItem() {
  const me = useQuery(api.users.currentUser);
  if (!me || me.role !== "admin") return null;
  return (
    <Link
      to="/admin"
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-white/80 hover:bg-white/10 hover:text-white [&.active]:bg-accent [&.active]:text-white [&.active]:font-semibold"
    >
      <ShieldCheck className="h-4 w-4" /> Admin
    </Link>
  );
}

function AppShell() {
  return (
    <div className="flex h-full">
      <aside className="flex w-60 flex-col bg-ink text-white">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <img src="/logo.svg" alt="IRES" className="h-9 w-9 rounded-lg" />
          <div className="leading-tight">
            <div className="text-sm font-bold">Instant Real Estate</div>
            <div className="text-[11px] font-semibold tracking-[0.2em] text-accent">SOLUTION</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3 text-sm">
          <NavItem to="/" label="Dashboard" />
          <NavItem to="/sheriff" label="Sheriff Sales" />
          <NavItem to="/legal" label="Legal Notices" />
          <AdminNavItem />
        </nav>
        <div className="flex items-center justify-between border-t border-white/10 p-4 text-[11px] text-white/40">
          <span>IRES CRM · dev</span>
          <UserButton />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Dashboard });
const sheriffRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sheriff", component: SheriffSales });
const legalRoute = createRoute({ getParentRoute: () => rootRoute, path: "/legal", component: LegalNotices });
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: AdminPage });

export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, adminRoute]);
