import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { EnvironmentStatus } from "@/lib/types";

/** One of the four status looks. globals.css gives each tone its three colours. */
export type Tone = "healthy" | "degraded" | "down" | "neutral";

const TONE_OF_STATUS: Record<EnvironmentStatus, Tone> = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  DOWN: "down",
  "NOT DEPLOYED": "neutral",
  UNKNOWN: "neutral",
};

export function toneOf(status: EnvironmentStatus): Tone {
  return TONE_OF_STATUS[status];
}

/** A small label in a status colour, with a dot. The word carries the meaning; the colour repeats it. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge
      data-tone={tone}
      className="gap-1.5 bg-tone-soft pr-2 pl-[7px] align-[1px] font-sans text-[11.5px] font-bold tracking-[0.03em] text-tone"
    >
      <span className="size-1.5 rounded-full bg-tone-solid" />
      {children}
    </Badge>
  );
}
