import { cn } from "cn";

import type { RolloMood } from "@/lib/types";

/** The eyes carry the mood: ovals when resting or busy, arcs when pleased, small dots when uneasy. */
function Eyes({ mood }: { mood: RolloMood }) {
  if (mood === "happy") {
    return (
      <g className="fill-none stroke-on-ink" strokeWidth="2.4" strokeLinecap="round">
        <path d="M16.4 27.8q3-5.4 6 0" />
        <path d="M25.6 27.8q3-5.4 6 0" />
      </g>
    );
  }
  if (mood === "worried") {
    return (
      <g className="fill-on-ink">
        <circle cx="19.4" cy="26.6" r="2" />
        <circle cx="28.6" cy="26.6" r="2" />
      </g>
    );
  }
  return (
    <g className="fill-on-ink">
      <rect x="17.3" y="22.5" width="4.2" height="7" rx="2.1" />
      <rect x="26.5" y="22.5" width="4.2" height="7" rx="2.1" />
    </g>
  );
}

/** One leg with its shoe. The two are one group, so they swing together. */
function Leg({ x, className }: { x: number; className: string }) {
  return (
    <g className={cn("rollo-leg", className)}>
      <rect x={x} y="52" width="4.8" height="11" rx="2.4" className="fill-primary-strong" />
      <rect x={x - 1} y="61" width="7.4" height="4.2" rx="2.1" className="fill-ink" />
    </g>
  );
}

interface RolloProps {
  mood?: RolloMood;
  /** Draws the whole robot, with arms and legs. Without it only the head is drawn: the picture next to a message. */
  hasBody?: boolean;
  /** A live Rollo blinks, and with a body it also floats and waves. The conversation stays calm without it. */
  isLive?: boolean;
  className?: string;
}

/** Rollo, the face of the assistant. globals.css moves it; this file only draws it. */
export function Rollo({ mood = "idle", hasBody = false, isLive = false, className }: RolloProps) {
  return (
    // Decoration only: the text next to Rollo always says the same in words.
    <svg
      viewBox={hasBody ? "0 0 48 67" : "0 0 48 48"}
      aria-hidden="true"
      data-mood={mood}
      data-body={hasBody ? "" : undefined}
      data-live={isLive ? "" : undefined}
      className={cn("rollo flex-none", className)}
    >
      {hasBody && (
        <>
          {/* The legs are drawn first, so the body covers where they join it. */}
          <Leg x={17.6} className="rollo-leg-a" />
          <Leg x={25.6} className="rollo-leg-b" />
          {/* The body. The square on its chest is a pod, the thing Rollo delivers. */}
          <rect x="15" y="39" width="18" height="16" rx="6.5" className="fill-primary" />
          <rect x="21.2" y="46" width="5.6" height="5.6" rx="1.7" className="fill-white/45" />
        </>
      )}

      {/* The antenna and its light. */}
      <path d="M24 6v5" strokeWidth="2.4" strokeLinecap="round" className="stroke-primary-strong" />
      <circle cx="24" cy="4.6" r="3.1" className="rollo-light" />
      {/* The ears. */}
      <rect x="2.5" y="21" width="5" height="11" rx="2.5" className="fill-primary-strong" />
      <rect x="40.5" y="21" width="5" height="11" rx="2.5" className="fill-primary-strong" />
      {/* The head, a shine on it, and the dark face plate. */}
      <rect x="6" y="10" width="36" height="33" rx="11" className="fill-primary" />
      <rect x="12" y="12.6" width="11" height="2" rx="1" className="fill-white/30" />
      <rect x="11.5" y="17.5" width="25" height="17" rx="8.5" className="fill-ink" />
      <g className="rollo-eyes">
        <Eyes mood={mood} />
      </g>

      {/* The arms come last: a raised arm passes in front of the head. */}
      {hasBody && (
        <g className="fill-primary-strong">
          <rect x="10.4" y="42.5" width="4.6" height="11.5" rx="2.3" className="rollo-arm rollo-arm-a" />
          <rect x="33" y="42.5" width="4.6" height="11.5" rx="2.3" className="rollo-arm rollo-arm-b" />
        </g>
      )}

      {/* Three dots rise from the head while Rollo thinks about an answer. */}
      {mood === "working" && !hasBody && (
        <g className="fill-primary">
          <circle cx="38.6" cy="9" r="1.2" className="rollo-thought" />
          <circle cx="42.2" cy="5.6" r="1.7" className="rollo-thought" />
          <circle cx="45.4" cy="2.6" r="2.2" className="rollo-thought" />
        </g>
      )}
    </svg>
  );
}
