"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowUp, Home, Landmark, Percent, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  formatCompactCurrency,
  formatDate,
  formatInteger,
} from "@/components/formater";

type MarketData = NonNullable<
  FunctionReturnType<typeof api.marketData.dashboardMetrics>
>;
type Item = MarketData["rates"][number];

function formatValue(unit: Item["unit"], value: number): string {
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "usd") return formatCompactCurrency(value);
  if (unit === "days") return `${Math.round(value)} days`;
  return formatInteger(value);
}

// Neutral change vs the prior observation — an increase isn't inherently good or
// bad for a rate/price, so this is intentionally uncolored (muted).
function ChangeLine({ item }: { item: Item }) {
  if (item.priorValue === null) return null;
  const diff = item.latestValue - item.priorValue;
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : null;
  const magnitude =
    item.unit === "percent"
      ? `${Math.abs(diff).toFixed(2)} pts`
      : item.unit === "usd"
        ? formatCompactCurrency(Math.abs(diff))
        : formatValue(item.unit, Math.abs(diff));
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs tabular-nums">
      {Icon ? <Icon className="size-3 shrink-0" /> : null}
      {diff === 0 ? "no change" : magnitude} vs prior
    </span>
  );
}

// Tiny pure-SVG sparkline (renders in headless screenshots; no animation).
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      aria-hidden
      className="text-teal-glow"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
    >
      <polyline
        fill="none"
        points={pts}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function RateCard({ item, icon: Icon }: { item: Item; icon: LucideIcon }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center justify-between font-normal text-muted-foreground text-xs">
          {item.label}
          <Icon className="size-4 text-muted-foreground/70" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-end justify-between gap-2">
          <p className="font-semibold text-2xl tabular-nums">
            {formatValue(item.unit, item.latestValue)}
          </p>
          <Sparkline values={item.history.map((p) => p.value)} />
        </div>
        <ChangeLine item={item} />
        <span className="text-muted-foreground text-xs">
          as of {formatDate(item.latestDate, "full")}
        </span>
      </CardContent>
    </Card>
  );
}

function InventoryCard({ items }: { items: Item[] }) {
  // Put the Delaware total last; counties first (catalog order already does this).
  return (
    <Card className="shadow-none lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Home className="size-4 text-muted-foreground/70" />
          Homes on the market
        </CardTitle>
        <CardDescription>Active listings by Delaware county</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableBody>
            {items.map((it) => (
              <TableRow className="hover:bg-transparent" key={it.seriesId}>
                <TableCell className="pl-6 font-medium">{it.region}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatValue(it.unit, it.latestValue)}
                </TableCell>
                <TableCell className="pr-6 text-right text-muted-foreground text-xs">
                  as of {formatDate(it.latestDate, "day-month")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TemperatureCard({ items }: { items: Item[] }) {
  return (
    <Card className="shadow-none lg:col-span-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground/70" />
          Market temperature
        </CardTitle>
        <CardDescription>How fast Delaware homes are moving</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {items.map((it) => (
            <div className="flex flex-col gap-1" key={it.seriesId}>
              <span className="text-muted-foreground text-xs">{it.label}</span>
              <span className="font-semibold text-xl tabular-nums">
                {formatValue(it.unit, it.latestValue)}
              </span>
              <span className="text-muted-foreground text-xs">
                {it.region} · as of {formatDate(it.latestDate, "day-month")}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const RATE_ICONS: Record<string, LucideIcon> = {
  mortgage30: Percent,
  fedFunds: Landmark,
};

export function MarketWidgets() {
  const data = useQuery(api.marketData.dashboardMetrics);
  // Render nothing until the first refresh has populated data — keeps the
  // dashboard unchanged pre-launch and during load.
  if (!data) return null;
  const hasAny =
    data.rates.length + data.inventory.length + data.temperature.length > 0;
  if (!hasAny) return null;
  return <MarketSection data={data} />;
}

// Pure presentational view (no data hook) — also lets the section render in a
// preview without a Convex client.
export function MarketSection({ data }: { data: MarketData }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-foreground text-lg tracking-tight">
          Delaware market
        </h2>
        {data.updatedAt ? (
          <span className="text-muted-foreground text-xs">
            Updated {formatDate(
              new Date(data.updatedAt).toISOString().slice(0, 10),
              "full",
            )}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.rates.map((it) => (
          <RateCard icon={RATE_ICONS[it.metric] ?? Percent} item={it} key={it.seriesId} />
        ))}
        {data.inventory.length > 0 ? (
          <InventoryCard items={data.inventory} />
        ) : null}
        {data.temperature.length > 0 ? (
          <TemperatureCard items={data.temperature} />
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">
        Source: FRED (Federal Reserve), Freddie Mac PMMS, Realtor.com
      </p>
    </section>
  );
}
