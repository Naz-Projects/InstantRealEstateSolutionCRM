import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Gavel, Scale, ShieldCheck, Calculator, Building2, MapPin, Target, HandCoins, ScanEye } from "lucide-react";

export type NavItem = {
	title: string;
	path: string;
	icon: LucideIcon;
	/** Only shown to admins (gated by the user's role in the sidebar). */
	adminOnly?: boolean;
};

// IRES top-level navigation. Paths map 1:1 to the TanStack Router routes.
export const navItems: NavItem[] = [
	{ title: "Dashboard", path: "/", icon: LayoutDashboard },
	{ title: "Leads", path: "/leads", icon: Target },
	{ title: "Sheriff Sales", path: "/sheriff", icon: Gavel },
	{ title: "Legal Notices", path: "/legal", icon: Scale },
	{ title: "Flip Analyzer", path: "/flip", icon: Calculator },
	{ title: "Properties", path: "/properties", icon: Building2 },
	{ title: "Parcels", path: "/parcels", icon: MapPin },
	{ title: "Buyers", path: "/buyers", icon: HandCoins },
	{ title: "Condition", path: "/condition", icon: ScanEye },
	{ title: "Admin", path: "/admin", icon: ShieldCheck, adminOnly: true },
];

/** The nav item matching the current pathname (exact for "/", prefix otherwise). */
export function activeNavItem(pathname: string): NavItem | undefined {
	return navItems.find((item) =>
		item.path === "/" ? pathname === "/" : pathname.startsWith(item.path),
	);
}
