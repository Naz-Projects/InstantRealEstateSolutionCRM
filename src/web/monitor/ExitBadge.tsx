import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { exitLabel } from "../../scraper/monitorPresent";

// One hue per exit (Design Direction). RENTAL is sky, not emerald: emerald means a
// positive number on this page.
const HUE: Record<string, string> = {
  FLIP: "border-teal/40 bg-teal/10 text-teal-glow",
  RENTAL: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  WHOLESALE: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  WHOLETAIL: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  PASS: "border-border bg-muted/40 text-muted-foreground",
};

export function ExitBadge({ exit }: { exit: string | null | undefined }) {
  if (!exit) return null;
  const key = exit.toUpperCase();
  return (
    <Badge variant="outline" className={cn("rounded-md uppercase tracking-wide", HUE[key] ?? HUE.PASS)}>
      {exitLabel(key)}
    </Badge>
  );
}
