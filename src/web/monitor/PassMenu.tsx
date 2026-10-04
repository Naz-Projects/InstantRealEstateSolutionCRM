import type { ReactNode } from "react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PASS_REASONS, type PassReason } from "../../scraper/monitorTriage";

// Controlled pass-with-reason menu. Controlled so the P key can open it for the
// selected row (or the open sheet). Radix layers correctly above the Sheet.
export function PassMenu({
  open, onOpenChange, onPick, trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (reason: PassReason) => void;
  trigger: ReactNode;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel>Pass because</DropdownMenuLabel>
        <DropdownMenuGroup>
          {PASS_REASONS.map((r) => (
            <DropdownMenuItem key={r.value} onSelect={() => onPick(r.value)}>
              {r.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
