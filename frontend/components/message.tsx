"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "cn";

import { Confirmation } from "@/components/confirmation";
import { ReplyText } from "@/components/reply-text";
import { Rollo } from "@/components/rollo";
import { Rollout } from "@/components/rollout";
import { SuggestionChips } from "@/components/suggestion-chips";
import { useOperation } from "@/hooks/use-operation";
import { ASSISTANT_NAME, MOOD_OF_ROLLOUT } from "@/lib/constants";
import { moodOfReply } from "@/lib/rollo-mood";
import type { ChatItem, RolloMood, RolloutState } from "@/lib/types";

/** "18:42" */
function formatClock(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Meta({ author, at }: { author: string; at?: string }) {
  return (
    <div className="flex gap-2 px-1 text-xs text-muted-foreground">
      <span className="font-bold text-foreground">{author}</span>
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
    <div className="flex max-w-[min(85%,640px)] animate-message-in flex-col items-end gap-1.5 self-end">
      <Meta author="You" at={item.at} />
      <div className="max-w-full rounded-[18px_18px_6px_18px] bg-linear-to-br from-primary to-primary-strong px-4 py-2.5 text-[14.5px] leading-[1.6] whitespace-pre-wrap text-primary-foreground shadow-soft [overflow-wrap:anywhere]">
        {item.text}
      </div>
    </div>
  );
}

interface AgentRowProps {
  mood: RolloMood;
  /** When it was said. Left out while Rollo is still working on the answer. */
  at?: string;
  isError?: boolean;
  children: ReactNode;
}

/** Everything Rollo says has the same frame: its face on the left, then its name and the message. */
function AgentRow({ mood, at, isError = false, children }: AgentRowProps) {
  return (
    <div className="flex max-w-full items-start gap-3 self-start">
      {/* Rollo does not fade in. An answer takes the place of "On it", so the face stays and only changes. */}
      <Rollo mood={mood} className="mt-0.5 size-10" />
      <div className="flex min-w-0 animate-message-in flex-col items-start gap-1.5">
        <Meta author={ASSISTANT_NAME} at={at} />
        <div
          className={cn(
            "max-w-full rounded-[6px_18px_18px_18px] border bg-card px-4 py-3 text-[14.5px] leading-[1.6] shadow-soft [overflow-wrap:anywhere]",
            isError && "border-down-solid bg-down-soft",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

interface RolloutMessageProps {
  item: ChatItem;
  operationId: string;
  /** Called once, when the change has succeeded or failed. */
  onFinished: () => void;
}

/** A reply about a change that was started. It follows the change, and Rollo's face follows it too. */
function RolloutMessage({ item, operationId, onFinished }: RolloutMessageProps) {
  const { operation, error } = useOperation(operationId);
  const state: RolloutState = error !== null ? "unknown" : (operation?.state ?? "running");
  const isFinished = state === "succeeded" || state === "failed";

  // After a page reload an old change is finished in the server's first answer. Only a
  // change the page has seen running is live: Rollo glides along its track and celebrates.
  const [isLive, setIsLive] = useState(false);
  const isRunningOnServer = operation?.state === "running";
  useEffect(() => {
    if (isRunningOnServer) {
      setIsLive(true);
    }
  }, [isRunningOnServer]);

  // An effect runs after the result is on screen, so the conversation can scroll down to it.
  useEffect(() => {
    if (isFinished) {
      onFinished();
    }
  }, [isFinished, onFinished]);

  return (
    <AgentRow mood={MOOD_OF_ROLLOUT[state]} at={item.at}>
      <ReplyText text={item.text} />
      <Rollout
        state={state}
        progress={operation?.steps.at(-1) ?? ""}
        message={error ?? operation?.message ?? ""}
        isLive={isLive}
      />
    </AgentRow>
  );
}

interface AgentMessageProps {
  item: ChatItem;
  onDecide: (actionId: string, choice: "confirm" | "cancel") => void;
  /** Called with a suggested request that was clicked. */
  onSuggest: (example: string) => void;
  onOperationFinished: () => void;
}

/** An agent reply: its text, then Confirm and Cancel, requests to try, or the progress of a change. */
export function AgentMessage({ item, onDecide, onSuggest, onOperationFinished }: AgentMessageProps) {
  const { action, operationId, suggestions } = item;
  if (operationId !== undefined) {
    return <RolloutMessage item={item} operationId={operationId} onFinished={onOperationFinished} />;
  }
  return (
    <AgentRow mood={moodOfReply(item.text, item.isError === true)} at={item.at} isError={item.isError}>
      <ReplyText text={item.text} />
      {action !== undefined && (
        <Confirmation action={action} note={item.actionNote} onDecide={(choice) => onDecide(action.id, choice)} />
      )}
      {suggestions !== undefined && suggestions.length > 0 && (
        // Sent with a reply that could not help: a way forward that takes one click.
        <div className="mt-2.5 grid animate-line-in gap-1.5" style={{ animationDelay: "90ms" }}>
          <span className="text-xs text-muted-foreground">Try one of these</span>
          <div className="flex flex-wrap gap-1.5">
            <SuggestionChips examples={suggestions} onPick={onSuggest} chipClassName="bg-sunken text-foreground" />
          </div>
        </div>
      )}
    </AgentRow>
  );
}

const FIRST_PHRASE = "On it";
const LATER_PHRASES = [
  { afterMs: 900, text: "Talking to the cluster" },
  { afterMs: 6000, text: "Still waiting for the cluster" },
];

/** How long after the dot before it each of the three dots starts to hop. */
const DOT_DELAYS_MS = [0, 140, 280];

/** Shown while the server is working on an answer: Rollo thinks, and says what it is doing. */
export function WorkingMessage() {
  const [phrase, setPhrase] = useState(FIRST_PHRASE);

  useEffect(() => {
    const timers = LATER_PHRASES.map(({ afterMs, text }) => setTimeout(() => setPhrase(text), afterMs));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <AgentRow mood="working">
      <div className="flex items-center gap-2.5">
        {/* A new key makes React draw the line again, so each new phrase rises in. */}
        <div key={phrase} className="animate-line-in">
          <span className="text-shimmer">{phrase}</span>
        </div>
        {/* The dots stay outside that line, so they keep hopping when the phrase changes. */}
        <span aria-hidden="true" className="flex gap-1">
          {DOT_DELAYS_MS.map((delayMs) => (
            <i
              key={delayMs}
              className="size-1.5 animate-typing-dot rounded-full bg-primary"
              style={{ animationDelay: `${delayMs}ms` }}
            />
          ))}
        </span>
      </div>
    </AgentRow>
  );
}
