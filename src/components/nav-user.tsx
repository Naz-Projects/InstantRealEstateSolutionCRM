"use client";

import { Link } from "@tanstack/react-router";
import { useUser, useClerk } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOutIcon, ShieldCheckIcon } from "lucide-react";

export function NavUser() {
	const { user } = useUser();
	const { signOut } = useClerk();
	const me = useQuery(api.users.currentUser);

	if (!user) {
		return null;
	}

	const email = user.primaryEmailAddress?.emailAddress ?? "";
	const name = user.fullName ?? email ?? "Account";
	const initial = (name.charAt(0) || "U").toUpperCase();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Avatar className="size-8 cursor-pointer">
					<AvatarImage alt={name} src={user.imageUrl} />
					<AvatarFallback>{initial}</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuLabel className="flex items-center gap-3 font-normal">
					<Avatar className="size-9">
						<AvatarImage alt={name} src={user.imageUrl} />
						<AvatarFallback>{initial}</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<div className="truncate font-medium text-foreground text-sm">
							{name}
						</div>
						<div className="truncate text-muted-foreground text-xs">{email}</div>
					</div>
				</DropdownMenuLabel>
				{me?.role === "admin" && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem asChild>
								<Link to="/admin">
									<ShieldCheckIcon />
									Admin
								</Link>
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem
						className="cursor-pointer"
						onSelect={() => {
							void signOut();
						}}
						variant="destructive"
					>
						<LogOutIcon />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
