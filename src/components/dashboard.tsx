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
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bar, BarChart, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Gavel, HandCoins, PhoneCall, Scale } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DEAL_STAGES, STAGE_LABEL } from "../web/dealStages";
import { formatInteger } from "@/components/formater";
import { MarketWidgets } from "@/components/market-widgets";

type Stats = NonNullable<FunctionReturnType<typeof api.runs.dashboardStats>>;
type Runs = FunctionReturnType<typeof api.runs.listRuns>;

function StatCard({
	label,
	value,
	footnote,
	icon: Icon,
}: {
	label: string;
	value: number;
	footnote: string;
	icon: LucideIcon;
}) {
	return (
		<Card className="shadow-none">
			<CardHeader>
				<CardTitle className="flex items-center justify-between font-normal text-muted-foreground text-xs">
					{label}
					<Icon className="size-4 text-muted-foreground/70" />
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-1">
				<p className="font-semibold text-2xl tabular-nums">
					{formatInteger(value)}
				</p>
				<span className="text-muted-foreground text-xs">{footnote}</span>
			</CardContent>
		</Card>
	);
}

const pipelineConfig = {
	sheriff: { label: "Sheriff Sales", color: "var(--chart-1)" },
	legal: { label: "Legal Notices", color: "var(--chart-2)" },
} satisfies ChartConfig;

function PipelineChart({ stats }: { stats: Stats }) {
	const data = DEAL_STAGES.map((s) => ({
		stage: STAGE_LABEL[s],
		sheriff: stats.sheriffByStage[s] ?? 0,
		legal: stats.legalByStage[s] ?? 0,
	}));

	return (
		<Card className="shadow-none lg:col-span-3">
			<CardHeader>
				<CardTitle>Deal pipeline by stage</CardTitle>
				<CardDescription>
					Sheriff Sales vs. Legal Notices across the pipeline
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ChartContainer className="h-64 w-full" config={pipelineConfig}>
					<BarChart accessibilityLayer data={data}>
						<CartesianGrid className="stroke-border" vertical={false} />
						<XAxis
							axisLine={false}
							dataKey="stage"
							tickLine={false}
							tickMargin={8}
						/>
						<YAxis
							allowDecimals={false}
							axisLine={false}
							tick={{ className: "tabular-nums" }}
							tickLine={false}
							tickMargin={8}
							width={32}
						/>
						<ChartTooltip content={<ChartTooltipContent />} cursor={false} />
						<ChartLegend content={<ChartLegendContent />} />
						<Bar dataKey="sheriff" fill="var(--color-sheriff)" radius={[4, 4, 0, 0]} />
						<Bar dataKey="legal" fill="var(--color-legal)" radius={[4, 4, 0, 0]} />
					</BarChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

const sourceConfig = {
	value: { label: "Listings" },
	sheriff: { label: "Sheriff Sales", color: "var(--chart-1)" },
	legal: { label: "Legal Notices", color: "var(--chart-2)" },
} satisfies ChartConfig;

function SourceChart({ stats }: { stats: Stats }) {
	const data = [
		{ source: "sheriff", value: stats.sheriffTotal, fill: "var(--color-sheriff)" },
		{ source: "legal", value: stats.legalTotal, fill: "var(--color-legal)" },
	];
	const total = stats.sheriffTotal + stats.legalTotal;

	return (
		<Card className="shadow-none lg:col-span-1">
			<CardHeader>
				<CardTitle>Listings by source</CardTitle>
				<CardDescription>{formatInteger(total)} total tracked</CardDescription>
			</CardHeader>
			<CardContent>
				<ChartContainer
					className="mx-auto aspect-square max-h-56"
					config={sourceConfig}
				>
					<PieChart>
						<ChartTooltip
							content={<ChartTooltipContent hideLabel nameKey="source" />}
						/>
						<Pie
							data={data}
							dataKey="value"
							innerRadius={55}
							nameKey="source"
							strokeWidth={2}
						/>
						<ChartLegend
							className="-translate-y-1 flex-wrap gap-2 [&>*]:justify-center"
							content={<ChartLegendContent nameKey="source" />}
						/>
					</PieChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}

const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
	sheriff: { label: "Sheriff", icon: Gavel },
	legal: { label: "Legal", icon: Scale },
};

function statusVariant(
	status: string,
): React.ComponentProps<typeof Badge>["variant"] {
	if (status === "complete") return "secondary";
	if (status === "failed") return "destructive";
	return "outline";
}

function RecentRuns({ runs }: { runs: Runs }) {
	const recent = runs.slice(0, 8);
	return (
		<Card className="gap-0 shadow-none lg:col-span-4">
			<CardHeader className="border-b">
				<CardTitle>Recent scrape runs</CardTitle>
				<CardDescription>
					Latest automations across Sheriff Sales and Legal Notices
				</CardDescription>
			</CardHeader>
			<CardContent className="p-0">
				{recent.length === 0 ? (
					<div className="px-6 py-10 text-center text-muted-foreground text-sm">
						No runs yet — trigger one from Sheriff Sales or Legal Notices.
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-6">Source</TableHead>
								<TableHead>Period</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Listings</TableHead>
								<TableHead className="pr-6 text-right">Enriched</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{recent.map((r) => {
								const meta = TYPE_META[r.type] ?? {
									label: r.type,
									icon: Gavel,
								};
								const Icon = meta.icon;
								return (
									<TableRow className="hover:bg-transparent" key={r._id}>
										<TableCell className="pl-6 font-medium">
											<span className="inline-flex items-center gap-2">
												<Icon className="size-3.5 shrink-0 text-muted-foreground" />
												{meta.label}
											</span>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{r.label || "—"}
										</TableCell>
										<TableCell>
											<Badge variant={statusVariant(r.status)}>{r.status}</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{r.listingCount}
										</TableCell>
										<TableCell className="pr-6 text-right tabular-nums">
											{r.enrichedCount}
											{r.failedCount ? (
												<span className="ml-1 text-destructive text-xs">
													({r.failedCount} failed)
												</span>
											) : null}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function DashboardSkeleton() {
	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{Array.from({ length: 4 }).map((_, i) => (
				<Skeleton className="h-28 w-full" key={i} />
			))}
			<Skeleton className="h-80 w-full lg:col-span-3" />
			<Skeleton className="h-80 w-full lg:col-span-1" />
			<Skeleton className="h-64 w-full lg:col-span-4" />
		</div>
	);
}

export function Dashboard() {
	const stats = useQuery(api.runs.dashboardStats);
	const runs = useQuery(api.runs.listRuns);

	return (
		<div className="flex flex-col gap-6 p-4 md:p-6">
			<div>
				<h1 className="font-semibold text-2xl text-foreground tracking-tight">
					Dashboard
				</h1>
				<p className="text-muted-foreground text-sm">
					Your wholesaling pipeline at a glance
				</p>
			</div>

			<MarketWidgets />

			{stats === undefined || runs === undefined ? (
				<DashboardSkeleton />
			) : (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<StatCard
						footnote={`${formatInteger(
							stats.sheriffByStage.reviewing +
								stats.sheriffByStage.contacted +
								stats.sheriffByStage.offer,
						)} active in pipeline`}
						icon={Gavel}
						label="Sheriff Listings"
						value={stats.sheriffTotal}
					/>
					<StatCard
						footnote={`${formatInteger(
							stats.legalByStage.reviewing +
								stats.legalByStage.contacted +
								stats.legalByStage.offer,
						)} active in pipeline`}
						icon={Scale}
						label="Legal Notices"
						value={stats.legalTotal}
					/>
					<StatCard
						footnote="across both sources"
						icon={PhoneCall}
						label="Contacted"
						value={
							stats.sheriffByStage.contacted + stats.legalByStage.contacted
						}
					/>
					<StatCard
						footnote="active offers"
						icon={HandCoins}
						label="Offers Made"
						value={stats.sheriffByStage.offer + stats.legalByStage.offer}
					/>

					<PipelineChart stats={stats} />
					<SourceChart stats={stats} />
					<RecentRuns runs={runs} />
				</div>
			)}
		</div>
	);
}
