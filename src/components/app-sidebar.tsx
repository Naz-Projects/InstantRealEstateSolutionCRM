import { Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { navItems } from "@/components/app-shared";

export function AppSidebar() {
	const { pathname } = useLocation();
	const me = useQuery(api.users.currentUser);
	const isAdmin = me?.role === "admin";
	const items = navItems.filter((item) => !item.adminOnly || isAdmin);

	return (
		<Sidebar collapsible="icon" variant="inset">
			<SidebarHeader className="h-14 justify-center">
				<SidebarMenuButton
					asChild
					className="h-auto hover:bg-transparent active:bg-transparent"
				>
					<Link to="/">
						<img
							alt="Instant Real Estate Solution"
							className="h-9 w-auto object-contain group-data-[collapsible=icon]:hidden"
							src="/ires-logo-onnavy.png"
						/>
						<img
							alt="IRES"
							className="hidden size-7 shrink-0 object-contain group-data-[collapsible=icon]:block"
							src="/ires-icon.png"
						/>
					</Link>
				</SidebarMenuButton>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup className="px-3 py-4">
					<SidebarMenu className="gap-2">
						{items.map((item) => {
							const isActive =
								item.path === "/"
									? pathname === "/"
									: pathname.startsWith(item.path);
							return (
								<SidebarMenuItem key={item.path}>
									<SidebarMenuButton
										asChild
										className="h-10 gap-3 rounded-lg px-3 text-[0.9rem] transition-all duration-300"
										isActive={isActive}
										tooltip={item.title}
									>
										<Link to={item.path}>
											<item.icon />
											<span>{item.title}</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<div className="px-2 pb-1 text-[11px] text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
					IRES CRM
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
