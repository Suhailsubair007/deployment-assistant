import { cn } from "cn";
import { Check, CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";

import { parsePodProgress } from "@/lib/pod-progress";
import { buildRolloutSteps } from "@/lib/rollout-steps";
import type { RolloutState, StepState } from "@/lib/types";

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
  return "border-input bg-muted";
}

/** The round mark in front of a step: a tick, a cross, a spinner, or an empty ring. */
function StepMark({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span className="grid size-5 animate-pop place-items-center rounded-full bg-healthy-solid text-white">
        <Check className="size-3" strokeWidth={3.5} />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="grid size-5 animate-pop place-items-center rounded-full bg-down-solid text-on-down">
        <X className="size-3" strokeWidth={3.5} />
      </span>
    );
  }
  if (state === "active") {
    return <LoaderCircle className="size-5 animate-spin text-primary" />;
  }
  return <span className="size-5 rounded-full border-2 border-input" />;
}

interface RolloutProps {
  state: RolloutState;
  /** The newest progress step the server reported, such as "2/3 pods ready". */
  progress: string;
  /** The final message, or the reason the page can no longer follow the change. */
  message: string;
}

/** The progress of a confirmed change: three steps that are ticked off, one square per pod, then the result. */
export function Rollout({ state, progress, message }: RolloutProps) {
  const pods = parsePodProgress(progress);
  const steps = buildRolloutSteps(state, pods);
  const isFinished = state === "succeeded" || state === "failed";

  return (
    <div className="mt-3 grid gap-3 border-t border-dashed border-input pt-3">
      <ol>
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.id} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5">
              <div className="flex flex-col items-center">
                <StepMark state={step.state} />
                {/* The line down to the next step turns green once this step is done. */}
                {!isLast && (
                  <span
                    className={cn(
                      "my-0.5 w-0.5 flex-1 rounded-full transition-colors duration-500",
                      step.state === "done" ? "bg-healthy-solid" : "bg-border",
                    )}
                  />
                )}
              </div>
              <div className={cn("grid gap-1", !isLast && "pb-3.5")}>
                <div
                  className={cn(
                    "leading-5 transition-colors duration-300",
                    step.state === "active" && "font-semibold",
                    step.state === "pending" && "text-muted-foreground",
                  )}
                >
                  {step.title}
                </div>
                {step.detail !== "" && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
                    {step.id === "pods" && pods !== null && (
                      // The words after the squares say the same.
                      <span aria-hidden="true" className="flex flex-wrap gap-1">
                        {Array.from({ length: pods.total }, (_, podIndex) => (
                          <span
                            key={podIndex}
                            className={cn(
                              "size-3.5 rounded-[4px] border transition-colors duration-300",
                              podClass(podIndex, pods.ready, state),
                            )}
                          />
                        ))}
                      </span>
                    )}
                    {step.detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

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
