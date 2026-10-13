"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "cn";

import { Buddy } from "@/components/buddy";
import { Confirmation } from "@/components/confirmation";
import { ReplyText } from "@/components/reply-text";
import { Rollout } from "@/components/rollout";
import { useOperation } from "@/hooks/use-operation";
import { moodOfReply } from "@/lib/buddy-mood";
import type { BuddyMood, ChatItem, RolloutState } from "@/lib/types";

/** "18:42" */
function formatClock(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Meta({ author, at }: { author: string; at?: string }) {
  return (
    <div className="flex gap-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{author}</span>
      {at !== undefined && <time dateTime={at}>{formatClock(at)}</time>}
    </div>
  );
}

const CLICK_NOTES: Record<string, string> = {
  "(clicked Confirm)": "You clicked Confirm",
  "(clicked Cancel)": "You clicked Cancel",
};

export function UserMessage({ item }: { item: ChatItem }) {
  const clickNote = CLICK_NOTES[item.text];
  if (clickNote !== undefined) {
    return (
      <div className="flex animate-message-in gap-1.5 self-end text-xs text-muted-foreground">
        {clickNote}
        <time dateTime={item.at}>{formatClock(item.at)}</time>
      </div>
    );
  }
  return (
    <div className="flex max-w-[min(85%,640px)] animate-message-in flex-col items-end gap-1 self-end">
      <Meta author="You" at={item.at} />
      <div className="max-w-full rounded-[16px_16px_5px_16px] bg-primary px-3.5 py-2 leading-[1.55] whitespace-pre-wrap text-primary-foreground [overflow-wrap:anywhere]">
        {item.text}
      </div>
    </div>
  );
}

interface AgentRowProps {
  mood: BuddyMood;
  /** When it was said. Left out while Buddy is still working on the answer. */
  at?: string;
  isError?: boolean;
  children: ReactNode;
}

/** Everything Buddy says has the same frame: its face on the left, then its name and the message. */
function AgentRow({ mood, at, isError = false, children }: AgentRowProps) {
  return (
    <div className="flex max-w-full items-start gap-2.5 self-start">
      {/* Buddy does not fade in. An answer takes the place of "On it", so the face stays and only changes. */}
      <Buddy mood={mood} className="mt-0.5 size-8" />
      <div className="flex min-w-0 animate-message-in flex-col items-start gap-1">
        <Meta author="Buddy" at={at} />
        <div
          className={cn(
            "max-w-full rounded-[5px_16px_16px_16px] border bg-sunken px-3.5 py-2.5 leading-[1.55] [overflow-wrap:anywhere]",
            isError && "border-down-solid bg-down-soft",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

const MOOD_OF_ROLLOUT: Record<RolloutState, BuddyMood> = {
  running: "working",
  succeeded: "happy",
  failed: "worried",
  unknown: "idle",
};

interface RolloutMessageProps {
  item: ChatItem;
  operationId: string;
  /** Called once, when the change has succeeded or failed. */
  onFinished: () => void;
}

/** A reply about a change that was started. It follows the change, and Buddy's face follows it too. */
function RolloutMessage({ item, operationId, onFinished }: RolloutMessageProps) {
  const { operation, error } = useOperation(operationId);
  const state: RolloutState = error !== null ? "unknown" : (operation?.state ?? "running");
  const isFinished = state === "succeeded" || state === "failed";

  // An effect runs after the result is on screen, so the conversation can scroll down to it.
  useEffect(() => {
    if (isFinished) {
      onFinished();
    }
  }, [isFinished, onFinished]);

  return (
    <AgentRow mood={MOOD_OF_ROLLOUT[state]} at={item.at}>
      <ReplyText text={item.text} />
      <Rollout state={state} progress={operation?.steps.at(-1) ?? ""} message={error ?? operation?.message ?? ""} />
    </AgentRow>
  );
}

interface AgentMessageProps {
  item: ChatItem;
  onDecide: (actionId: string, choice: "confirm" | "cancel") => void;
  onOperationFinished: () => void;
}

/** An agent reply: its text, then Confirm and Cancel, or the progress of a change. */
export function AgentMessage({ item, onDecide, onOperationFinished }: AgentMessageProps) {
  const { action, operationId } = item;
  if (operationId !== undefined) {
    return <RolloutMessage item={item} operationId={operationId} onFinished={onOperationFinished} />;
  }
  return (
    <AgentRow mood={moodOfReply(item.text, item.isError === true)} at={item.at} isError={item.isError}>
      <ReplyText text={item.text} />
      {action !== undefined && (
        <Confirmation action={action} note={item.actionNote} onDecide={(choice) => onDecide(action.id, choice)} />
      )}
    </AgentRow>
  );
}

const FIRST_PHRASE = "On it";
const LATER_PHRASES = [
  { afterMs: 900, text: "Talking to the cluster" },
  { afterMs: 6000, text: "Still waiting for the cluster" },
];

/** Shown while the server is working on an answer. */
export function WorkingMessage() {
  const [phrase, setPhrase] = useState(FIRST_PHRASE);

  useEffect(() => {
    const timers = LATER_PHRASES.map(({ afterMs, text }) => setTimeout(() => setPhrase(text), afterMs));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <AgentRow mood="working">
      {/* A new key makes React draw the line again, so each new phrase rises in. */}
      <div key={phrase} className="animate-line-in">
        <span className="text-shimmer">{phrase}…</span>
      </div>
    </AgentRow>
  );
}
