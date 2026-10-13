import { cn } from "cn";
import { RefreshCw } from "lucide-react";

import { StatusPill, toneOf } from "@/components/status-pill";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { EnvironmentStatusState } from "@/hooks/use-environment-status";
import type { EnvironmentSummary } from "@/lib/types";

const CARD = "relative overflow-hidden rounded-xl border bg-card py-3 pr-3 pl-4";

interface EnvironmentCardProps {
  summary: EnvironmentSummary;
  /** How long after the page opens the card appears, so the cards come in one after the other. */
  delayMs: number;
}

function EnvironmentCard({ summary, delayMs }: EnvironmentCardProps) {
  const lastUpdate =
    summary.lastUpdate !== null
      ? new Date(summary.lastUpdate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      : "no deployment recorded";

  return (
    // A strip in the status colour down the left edge, readable from across the room.
    <div
      data-tone={toneOf(summary.status)}
      style={{ animationDelay: `${delayMs}ms` }}
      className={cn(
        CARD,
        "animate-message-in before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-tone-solid before:transition-colors before:duration-500",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-[15px] font-semibold">{summary.environment}</span>
          <span className="ml-1.5 text-[12.5px] text-muted-foreground">{summary.app}</span>
        </div>
        <StatusPill tone={toneOf(summary.status)}>{summary.status}</StatusPill>
      </div>

      <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-[3px] text-[13px] [overflow-wrap:anywhere]">
        <dt className="text-muted-foreground">Image</dt>
        <dd className="font-mono text-[12.5px] leading-[1.6]">{summary.image ?? "none"}</dd>
        <dt className="text-muted-foreground">Last update</dt>
        <dd>{lastUpdate}</dd>
      </dl>

      {summary.reason !== "" && (
        <p className="mt-2.5 rounded-md bg-tone-soft px-2 py-1.5 text-[12.5px] text-tone [overflow-wrap:anywhere]">
          {summary.reason}
        </p>
      )}
    </div>
  );
}

/** A grey card that shows until the first answer arrives. */
function PlaceholderCard() {
  return (
    <div className={cn(CARD, "grid gap-2.5")}>
      <Skeleton className="h-3.5 w-[45%]" />
      <Skeleton className="h-2.5" />
      <Skeleton className="h-2.5 w-[70%]" />
    </div>
  );
}

/** One card per environment: status, image and last update, with a Refresh button. */
export function StatusPanel({ status }: { status: EnvironmentStatusState }) {
  const { cluster, environments, checkedAt, error, isRefreshing, refresh } = status;
  const hasCards = environments !== null && environments.length > 0;

  let checkedText = "Checking the cluster...";
  if (environments !== null) {
    checkedText = checkedAt === null ? "Not checked yet" : `Checked at ${new Date(checkedAt).toLocaleTimeString()}`;
  }

  return (
    // On a small screen the panel sits above the chat; on a wide one it is the right column.
    <Card
      role="complementary"
      aria-label="Environment status"
      className="order-first max-h-full min-h-0 gap-0 rounded-2xl py-0 shadow-soft min-[861px]:order-none min-[861px]:self-start"
    >
      <div className="flex items-center justify-between gap-3 border-b py-2.5 pr-3 pl-4">
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-[-0.01em]">Environments</h2>
          {/* The cluster these environments are in. On EKS the name is long, so it may take two lines. */}
          {cluster !== null && (
            <p
              title="The cluster the assistant is connected to. The deployment history is kept per cluster."
              className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]"
            >
              Cluster <span className="font-mono text-[11.5px] text-foreground">{cluster}</span>
            </p>
          )}
        </div>
        {/* The button is switched off only while a check is running. */}
        <Button variant="outline" disabled={isRefreshing} onClick={refresh} className="h-[30px] px-2.5 text-[12.5px]">
          <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error !== null && (
        <Alert className="mx-3 mt-3 w-auto border-down-solid bg-down-soft">
          <AlertDescription className="text-[13px] text-down">
            {hasCards ? `${error} The cards below are from the last check that worked.` : error}
          </AlertDescription>
        </Alert>
      )}

      {(environments === null || hasCards) && (
        <div
          className={cn(
            "grid min-h-0 auto-cols-[minmax(240px,1fr)] grid-flow-col gap-2.5 overflow-auto p-3 min-[861px]:auto-cols-auto min-[861px]:grid-flow-row",
            error !== null && "opacity-55",
          )}
        >
          {environments === null ? (
            <>
              <PlaceholderCard />
              <PlaceholderCard />
            </>
          ) : (
            environments.map((summary, index) => (
              <EnvironmentCard key={`${summary.environment}/${summary.app}`} summary={summary} delayMs={index * 70} />
            ))
          )}
        </div>
      )}

      <p className="border-t px-4 py-[9px] text-xs text-muted-foreground">
        {/* Until the first answer arrives, a band of light moves across the words. */}
        <span className={cn(environments === null && "text-shimmer")}>{checkedText}</span>
      </p>
    </Card>
  );
}
