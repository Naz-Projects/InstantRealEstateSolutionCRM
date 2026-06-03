"use client";

import { useLocation } from "@tanstack/react-router";
import { Separator } from "@/components/ui/separator";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { CustomSidebarTrigger } from "@/components/custom-sidebar-trigger";
import { activeNavItem } from "@/components/app-shared";
import { NavUser } from "@/components/nav-user";

export function AppHeader() {
	const { pathname } = useLocation();
	const active = activeNavItem(pathname);

	return (
		<header className="sticky top-0 z-50 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background px-4 md:px-6">
			{/* IRES wordmark, centered in the bar (non-interactive branding). */}
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
				<img
					src="/ires-logo-onnavy.png"
					alt="Instant Real Estate Solution"
					className="h-8 w-auto object-contain"
				/>
			</div>
			<div className="flex items-center gap-3">
				<CustomSidebarTrigger />
				<Separator
					className="mr-2 h-4 data-[orientation=vertical]:self-center"
					orientation="vertical"
				/>
				<AppBreadcrumbs
					page={
						active
							? { title: active.title, icon: <active.icon className="size-3.5" /> }
							: undefined
					}
				/>
			</div>
			<div className="flex items-center gap-3">
				<NavUser />
			</div>
		</header>
	);
}
