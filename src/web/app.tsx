import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";
import { SheriffSales, LegalNotices } from "./pages";
import { AdminPage } from "./admin/AdminPage";
import { FlipAnalyzer } from "./FlipAnalyzer";
import { Properties } from "./Properties";
import { PropertyDetail } from "./PropertyDetail";
import { ParcelSearch } from "./ParcelSearch";
import { LeadsPage } from "./LeadsPage";
import { PotentialPage } from "./PotentialPage";
import { BuyersPage } from "./BuyersPage";
import { ConditionTest } from "./ConditionTest";
import { MonitorPage } from "./MonitorPage";

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
// Typed search params for the lead → flip handoff: address + known value/sqft so
// the analyzer can prefill ARV/sqft without re-pulling comps.
type FlipSearch = { address?: string; value?: number; sqft?: number };
const flipRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/flip",
  component: FlipAnalyzer,
  validateSearch: (search: Record<string, unknown>): FlipSearch => {
    const numOrUndef = (v: unknown) => {
      const n = Number(v);
      return v != null && v !== "" && Number.isFinite(n) ? n : undefined;
    };
    return {
      address: typeof search.address === "string" ? search.address : undefined,
      value: numOrUndef(search.value),
      sqft: numOrUndef(search.sqft),
    };
  },
});
const propertiesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/properties", component: Properties });
const propertyDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: "/properties/$id", component: PropertyDetail });
const parcelsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/parcels", component: ParcelSearch });
const leadsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/leads", component: LeadsPage });
const potentialRoute = createRoute({ getParentRoute: () => rootRoute, path: "/potential", component: PotentialPage });
const buyersRoute = createRoute({ getParentRoute: () => rootRoute, path: "/buyers", component: BuyersPage });
const conditionRoute = createRoute({ getParentRoute: () => rootRoute, path: "/condition", component: ConditionTest });
const monitorRoute = createRoute({ getParentRoute: () => rootRoute, path: "/monitor", component: MonitorPage });

export const routeTree = rootRoute.addChildren([indexRoute, sheriffRoute, legalRoute, flipRoute, propertiesRoute, propertyDetailRoute, parcelsRoute, leadsRoute, potentialRoute, buyersRoute, conditionRoute, monitorRoute, adminRoute]);
