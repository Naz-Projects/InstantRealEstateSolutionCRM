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
	// Unresolved-error count badge on the Admin item (admins only; skip for members).
	const unresolved = useQuery(api.errors.unresolvedCount, isAdmin ? {} : "skip");

	return (
		<Sidebar collapsible="icon" variant="inset">
			<SidebarHeader className="h-14 justify-center px-2">
				<Link
					to="/"
					className="flex items-center justify-center group-data-[collapsible=icon]:hidden"
				>
					<img
						alt="Instant Real Estate Solution"
						className="h-10 w-auto object-contain"
						src="/ires-logo-onnavy.png"
					/>
				</Link>
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
											{item.path === "/admin" && !!unresolved && (
												<span className="ml-auto rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-400 group-data-[collapsible=icon]:hidden">
													{unresolved}
												</span>
											)}
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
