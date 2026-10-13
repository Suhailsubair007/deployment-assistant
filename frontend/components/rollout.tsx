import type { CSSProperties } from "react";
import { cn } from "cn";
import { Check, CircleAlert, CircleCheck, Flag, LoaderCircle, X } from "lucide-react";

import { Rollo } from "@/components/rollo";
import { MOOD_OF_ROLLOUT } from "@/lib/constants";
import { podProgressAt } from "@/lib/pod-progress";
import { buildRolloutSteps, currentStep } from "@/lib/rollout-steps";
import { podPosition, runnerPosition, trackParts } from "@/lib/rollout-track";
import type { OperationStage, PodProgress, RolloutState, RolloutStep, StepState } from "@/lib/types";

/** How a mark on the track looks: the square of a pod, or the dot where a stage before the pods ends. */
const MARK_CLASS: Record<StepState, string> = {
  done: "animate-pop border-healthy-solid bg-healthy-solid",
  active: "animate-pod-starting border-primary bg-primary",
  failed: "border-down-solid bg-down-soft",
  pending: "border-input bg-card",
};

/** A filled square is a ready pod. The first one that is not ready is the pod starting right now. */
function podState(index: number, ready: number, state: RolloutState): StepState {
  if (index < ready) {
    return "done";
  }
  if (state === "running" && index === ready) {
    return "active";
  }
  return state === "failed" ? "failed" : "pending";
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

/** The word under each stage's part of the track. */
const STAGE_LABEL: Record<OperationStage, string> = {
  repository: "Repository",
  build: "Build",
  publish: "Upload",
  pods: "Pods",
};

interface TrackProps {
  state: RolloutState;
  pods: PodProgress | null;
  /** Every step of the change. A stage before the pods is drawn as a dot in the state of its step. */
  steps: RolloutStep[];
  /** Only for a change that builds an image: the stages it goes through, and the one it is at. */
  stages?: OperationStage[];
  stage?: OperationStage;
  /** The page saw this change running. Only then does Rollo glide along the track and celebrate at the end. */
  isLive: boolean;
}

/**
 * The picture of a change: a track with one square per pod, and Rollo running along it to the flag.
 * A change that builds an image has a dot for each stage before the pods, and the pods come after them.
 */
function Track({ state, pods, steps, stages, stage, isLive }: TrackProps) {
  const position = runnerPosition(state, pods, stages, stage);
  const parts = trackParts(stages);
  const podsPart = parts.find((part) => part.stage === "pods");
  // Rollo and the coloured line behind it take the same time, so the line follows Rollo.
  // An old change gets no glide: it is drawn at once where it ended.
  const glide = isLive && "transition-[left,transform,background-color] duration-700 ease-out";

  return (
    // Decoration only: the headline above the track says the same in words.
    // "@container" lets the words under the track ask how wide the picture is.
    <div aria-hidden="true" className="@container">
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
            {parts.map(
              (part) =>
                part.stage !== "pods" && (
                  <span
                    key={part.stage}
                    style={at(part.end)}
                    className={cn(
                      "absolute bottom-1 size-2.5 -translate-x-1/2 rounded-full border transition-colors duration-300",
                      MARK_CLASS[steps.find((step) => step.id === part.stage)?.state ?? "pending"],
                    )}
                  />
                ),
            )}
            {pods !== null &&
              Array.from({ length: pods.total }, (_, index) => (
                <span
                  key={index}
                  style={at(podPosition(index, pods.total, podsPart))}
                  className={cn(
                    "absolute bottom-0.5 size-3.5 -translate-x-1/2 rounded-[4px] border transition-colors duration-300",
                    MARK_CLASS[podState(index, pods.ready, state)],
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
      <div className="relative mt-1 flex justify-between pl-7 text-[11.5px] text-muted-foreground">
        <span>Sent</span>
        {stages !== undefined && (
          // Measured like the track above it, so each word stands under its own dot and "Pods" under
          // the squares. A picture narrower than 400px has no room for the words.
          <div className="absolute inset-y-0 right-11 left-10 hidden @min-[400px]:block">
            {parts.map((part) => (
              <span
                key={part.stage}
                style={at(part.stage === "pods" ? (part.start + part.end) / 2 : part.end)}
                className="absolute -translate-x-1/2"
              >
                {STAGE_LABEL[part.stage]}
              </span>
            ))}
          </div>
        )}
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
  /** Only for a change that builds an image: the stages it goes through, and the one it is at. */
  stages?: OperationStage[];
  stage?: OperationStage;
  /** The page saw this change running, so it is not an old one drawn again after a reload. */
  isLive: boolean;
}

/** The progress of a confirmed change: the step it is at, Rollo running along the track, then the result. */
export function Rollout({ state, progress, message, stages, stage, isLive }: RolloutProps) {
  const pods = podProgressAt(stage, progress);
  const steps = buildRolloutSteps(state, pods, stages, stage);
  const headline = currentStep(steps);
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

      <Track state={state} pods={pods} steps={steps} stages={stages} stage={stage} isLive={isLive} />

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
