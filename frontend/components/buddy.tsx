import { cn } from "cn";

import type { BuddyMood } from "@/lib/buddy-mood";

/** The eyes carry the mood: ovals when resting or busy, arcs when pleased, small dots when uneasy. */
function Eyes({ mood }: { mood: BuddyMood }) {
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

interface BuddyProps {
  mood?: BuddyMood;
  /** A live Buddy blinks. Only the big one on the welcome screen does, so the conversation stays calm. */
  isLive?: boolean;
  className?: string;
}

/**
 * Buddy, the face of the assistant. The head is the same rounded square as a pod in a rollout.
 * The colour of the light and all movement are in globals.css, chosen by data-mood.
 */
export function Buddy({ mood = "idle", isLive = false, className }: BuddyProps) {
  return (
    // Decoration only: the text next to Buddy always says the same in words.
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      data-mood={mood}
      data-live={isLive ? "" : undefined}
      className={cn("buddy flex-none", className)}
    >
      {/* The antenna and its light. */}
      <path d="M24 6v5" strokeWidth="2.4" strokeLinecap="round" className="stroke-primary-strong" />
      <circle cx="24" cy="4.6" r="3.1" className="buddy-light" />
      {/* The ears. */}
      <rect x="2.5" y="21" width="5" height="11" rx="2.5" className="fill-primary-strong" />
      <rect x="40.5" y="21" width="5" height="11" rx="2.5" className="fill-primary-strong" />
      {/* The head, a shine on it, and the dark face plate. */}
      <rect x="6" y="10" width="36" height="33" rx="11" className="fill-primary" />
      <rect x="12" y="12.6" width="11" height="2" rx="1" className="fill-white/30" />
      <rect x="11.5" y="17.5" width="25" height="17" rx="8.5" className="fill-ink" />
      <g className="buddy-eyes">
        <Eyes mood={mood} />
      </g>
    </svg>
  );
}
