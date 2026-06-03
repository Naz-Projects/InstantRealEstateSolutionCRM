import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<TooltipProvider delayDuration={0}>
			<div className="overflow-hidden">
				<SidebarProvider className="relative h-svh">
					<AppSidebar />
					<SidebarInset className="overflow-hidden md:peer-data-[variant=inset]:ml-0">
						<AppHeader />
						<div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
					</SidebarInset>
				</SidebarProvider>
			</div>
		</TooltipProvider>
	);
}
