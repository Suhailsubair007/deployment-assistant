"use client";

import { useEffect } from "react";
import { cn } from "cn";
import { LoaderCircle } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import { useOperation } from "@/hooks/use-operation";
import { parsePodProgress } from "@/lib/pod-progress";

type RolloutState = "running" | "succeeded" | "failed" | "unknown";

/** A filled square is a ready pod. The first one that is not ready is the pod starting right now. */
function podClass(index: number, ready: number, state: RolloutState): string {
  if (index < ready) {
    return "border-healthy-solid bg-healthy-solid";
  }
  if (state === "running" && index === ready) {
    return "animate-pod-starting border-primary bg-primary";
  }
  if (state === "failed") {
    return "border-down-solid bg-down-soft";
  }
  return "border-input bg-muted";
}

interface RolloutProps {
  operationId: string;
  /** Called once, when the change has succeeded or failed. */
  onFinished: () => void;
}

/** The progress of a change that was confirmed: one square per pod, the steps so far, then the result. */
export function Rollout({ operationId, onFinished }: RolloutProps) {
  const { operation, error } = useOperation(operationId);
  const state: RolloutState = error !== null ? "unknown" : (operation?.state ?? "running");
  const isFinished = state === "succeeded" || state === "failed";

  // An effect runs after the result is on screen, so the conversation can scroll down to it.
  useEffect(() => {
    if (isFinished) {
      onFinished();
    }
  }, [isFinished, onFinished]);

  const steps = operation?.steps ?? [];
  const pods = parsePodProgress(steps.at(-1) ?? "");
  const trail = steps.join("  ->  ");
  const waiting = state === "running" ? "Waiting for the first pod..." : "";
  const stepsText = error ?? (trail !== "" ? trail : waiting);

  return (
    <div className="mt-2.5 grid gap-2 border-t border-dashed border-input pt-2.5 font-sans">
      {pods !== null && (
        // The line of text below says the same in words.
        <div aria-hidden="true" className="flex flex-wrap gap-1">
          {Array.from({ length: pods.total }, (_, index) => (
            <span key={index} className={cn("size-4 rounded-[4px] border", podClass(index, pods.ready, state))} />
          ))}
        </div>
      )}
      {stepsText !== "" && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          {state === "running" && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" />}
          {stepsText}
        </div>
      )}
      {isFinished && operation !== null && (
        <div className="whitespace-pre-wrap">
          <StatusPill tone={operation.state === "succeeded" ? "healthy" : "down"}>
            {operation.state === "succeeded" ? "DONE" : "FAILED"}
          </StatusPill>{" "}
          {operation.message}
        </div>
      )}
    </div>
  );
}
