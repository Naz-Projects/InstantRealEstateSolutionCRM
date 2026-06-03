import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";
import { SheriffSales, LegalNotices } from "./pages";
import { AdminPage } from "./admin/AdminPage";

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Dashboard });
const sheriffRoute = createRoute({ getParentRoute: () => rootRoute, path: "/sheriff", component: SheriffSales });
const legalRoute = createRoute({ getParentRoute: () => rootRoute, path: "/legal", component: LegalNotices });
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: AdminPage });

export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, adminRoute]);
