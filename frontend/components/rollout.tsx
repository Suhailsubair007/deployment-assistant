import type { CSSProperties } from "react";
import { cn } from "cn";
import { Check, CircleAlert, CircleCheck, Flag, LoaderCircle, X } from "lucide-react";

import { Rollo } from "@/components/rollo";
import { MOOD_OF_ROLLOUT } from "@/lib/constants";
import { parsePodProgress } from "@/lib/pod-progress";
import { buildRolloutSteps, currentStep } from "@/lib/rollout-steps";
import { podPosition, runnerPosition } from "@/lib/rollout-track";
import type { PodProgress, RolloutState, StepState } from "@/lib/types";

/** A filled square is a ready pod. The first one that is not ready is the pod starting right now. */
function podClass(index: number, ready: number, state: RolloutState): string {
  if (index < ready) {
    return "animate-pop border-healthy-solid bg-healthy-solid";
  }
  if (state === "running" && index === ready) {
    return "animate-pod-starting border-primary bg-primary";
  }
  if (state === "failed") {
    return "border-down-solid bg-down-soft";
  }
  return "border-input bg-card";
}

/** The round mark in front of the headline: a tick, a cross, a spinner, or an empty ring. */
function StepMark({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="grid size-5 flex-none animate-pop place-items-center rounded-full bg-healthy-solid text-white">
        <Check className="size-3" strokeWidth={3.5} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="grid size-5 flex-none animate-pop place-items-center rounded-full bg-down-solid text-on-down">
        <X className="size-3" strokeWidth={3.5} />
      </span>
    );
  }
  if (state === "active") {
    return <LoaderCircle className="size-5 flex-none animate-spin text-primary" />;
  }
  return <span className="size-5 flex-none rounded-full border-2 border-input" />;
}

/** The colour of the part of the track that Rollo has covered. */
const COVERED_CLASS: Record<RolloutState, string> = {
  running: "bg-primary",
  succeeded: "bg-healthy-solid",
  failed: "bg-down-solid",
  unknown: "bg-input",
};

/** The three lines behind Rollo while it runs. Each one starts a moment after the one above it. */
const SPEED_LINES = [
  { width: 10, delayMs: 0 },
  { width: 6, delayMs: 180 },
  { width: 12, delayMs: 360 },
];

/** The confetti of a success: how far each piece flies, in pixels, and its colour. */
const CONFETTI = [
  { x: -34, y: -30, colour: "bg-primary" },
  { x: -20, y: -48, colour: "bg-healthy-solid" },
  { x: -6, y: -58, colour: "bg-primary-strong" },
  { x: 8, y: -56, colour: "bg-healthy-solid" },
  { x: 22, y: -44, colour: "bg-primary" },
  { x: 32, y: -26, colour: "bg-healthy-solid" },
];

/** Puts something at a position on the track, where 0 is the start and 1 is the end. */
function at(position: number): CSSProperties {
  return { left: `${position * 100}%` };
}

interface TrackProps {
  state: RolloutState;
  pods: PodProgress | null;
  /** The page saw this change running. Only then does Rollo glide along the track and celebrate at the end. */
  isLive: boolean;
}

/** The picture of a change: a track with one square per pod, and Rollo running along it to the flag. */
function Track({ state, pods, isLive }: TrackProps) {
  const position = runnerPosition(state, pods);
  // Rollo and the coloured line behind it take the same time, so the line follows Rollo.
  // An old change gets no glide: it is drawn at once where it ended.
  const glide = isLive && "transition-[left,transform,background-color] duration-700 ease-out";

  return (
    // Decoration only: the headline above the track says the same in words.
    <div aria-hidden="true">
      <div className="flex items-end gap-1">
        <div className="relative h-[70px] min-w-0 flex-1">
          {/* Positions are measured on this part. It starts and ends a little inside the
              picture, so Rollo and the lines behind it are never drawn outside it. */}
          <div className="absolute inset-y-0 right-5 left-10">
            <span className="absolute -right-5 bottom-[7px] left-0 h-1 rounded-full bg-muted" />
            <span
              className={cn("absolute inset-x-0 bottom-[7px] h-1 origin-left rounded-full", COVERED_CLASS[state], glide)}
              style={{ transform: `scaleX(${position})` }}
            />
            <span className="absolute bottom-1 left-0 size-2.5 -translate-x-1/2 rounded-full bg-healthy-solid" />
            {pods !== null &&
              Array.from({ length: pods.total }, (_, index) => (
                <span
                  key={index}
                  style={at(podPosition(index, pods.total))}
                  className={cn(
                    "absolute bottom-0.5 size-3.5 -translate-x-1/2 rounded-[4px] border transition-colors duration-300",
                    podClass(index, pods.ready, state),
                  )}
                />
              ))}

            <div style={at(position)} className={cn("absolute bottom-2.5 -translate-x-1/2", glide)}>
              {state === "running" && (
                <span className="absolute top-[52%] right-full mr-0.5 grid justify-items-end gap-[5px]">
                  {SPEED_LINES.map(({ width, delayMs }) => (
                    <i
                      key={delayMs}
                      className="block h-0.5 animate-speed-line rounded-full bg-primary/60"
                      style={{ width, animationDelay: `${delayMs}ms` }}
                    />
                  ))}
                </span>
              )}
              <Rollo hasBody mood={MOOD_OF_ROLLOUT[state]} className="h-14 w-10" />
              {isLive &&
                state === "succeeded" &&
                CONFETTI.map(({ x, y, colour }) => (
                  <i
                    key={x}
                    className={cn("confetti absolute bottom-7 left-1/2 size-1.5 animate-confetti rounded-[2px]", colour)}
                    style={{ "--x": `${x}px`, "--y": `${y}px` } as CSSProperties}
                  />
                ))}
            </div>
          </div>
        </div>
        {/* key draws the flag again when the change succeeds, so the flag pops as it turns green. */}
        <Flag
          key={state}
          className={cn(
            "mb-1.5 size-5 flex-none",
            state === "succeeded" ? "animate-pop fill-healthy-solid text-healthy-solid" : "text-input",
          )}
        />
      </div>
      {/* The padding puts "Sent" under the dot where the track starts. */}
      <div className="mt-1 flex justify-between pl-7 text-[11.5px] text-muted-foreground">
        <span>Sent</span>
        <span>Finished</span>
      </div>
    </div>
  );
}

interface RolloutProps {
  state: RolloutState;
  /** The newest progress step the server reported, such as "2/3 pods ready". */
  progress: string;
  /** The final message, or the reason the page can no longer follow the change. */
  message: string;
  /** The page saw this change running, so it is not an old one drawn again after a reload. */
  isLive: boolean;
}

/** The progress of a confirmed change: the step it is at, Rollo running along the track, then the result. */
export function Rollout({ state, progress, message, isLive }: RolloutProps) {
  const pods = parsePodProgress(progress);
  const headline = currentStep(buildRolloutSteps(state, pods));
  const isFinished = state === "succeeded" || state === "failed";

  return (
    // A fixed width: the track needs room, however short the sentence above it is.
    <div className="mt-3 grid w-[440px] max-w-full gap-3 border-t border-dashed border-input pt-3">
      {headline !== undefined && (
        <div className="flex items-center gap-2.5">
          <StepMark state={headline.state} />
          <span className={cn("font-semibold", state === "running" && "text-shimmer")}>{headline.title}</span>
          {headline.detail !== "" && (
            // A new key makes React draw the count again, so each new count rises in.
            <span key={headline.detail} className="ml-auto animate-line-in text-[13px] font-medium text-muted-foreground tabular-nums">
              {headline.detail}
            </span>
          )}
        </div>
      )}

      <Track state={state} pods={pods} isLive={isLive} />

      {isFinished && (
        <div
          data-tone={state === "succeeded" ? "healthy" : "down"}
          className="flex animate-line-in gap-2 rounded-lg bg-tone-soft px-3 py-2"
        >
          {state === "succeeded" ? (
            <CircleCheck className="mt-[3px] size-4 flex-none text-tone" />
          ) : (
            <CircleAlert className="mt-[3px] size-4 flex-none text-tone" />
          )}
          {/* A failure message says by itself what failed, so only a success gets a word in front. */}
          <p>
            {state === "succeeded" && <span className="font-semibold text-tone">Done. </span>}
            {message}
          </p>
        </div>
      )}
      {state === "unknown" && <p className="text-[12.5px] text-muted-foreground">{message}</p>}
    </div>
  );
}
