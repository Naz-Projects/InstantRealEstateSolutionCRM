import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";
import { SheriffSales, LegalNotices } from "./pages";
import { AdminPage } from "./admin/AdminPage";
import { FlipAnalyzer } from "./FlipAnalyzer";
import { Properties } from "./Properties";
import { PropertyDetail } from "./PropertyDetail";
import { ParcelSearch } from "./ParcelSearch";

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
const flipRoute = createRoute({ getParentRoute: () => rootRoute, path: "/flip", component: FlipAnalyzer });
const propertiesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/properties", component: Properties });
const propertyDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/properties/$id", component: PropertyDetail });
const parcelsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/parcels", component: ParcelSearch });

export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, flipRoute, propertiesRoute, propertyDetailRoute, parcelsRoute, adminRoute]);
