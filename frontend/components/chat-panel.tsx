"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";

import { AgentMessage, UserMessage, WorkingMessage } from "@/components/message";
import { SuggestionChips } from "@/components/suggestion-chips";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Welcome } from "@/components/welcome";
import { useConversation } from "@/hooks/use-conversation";
import { buildSuggestions } from "@/lib/suggestions";
import type { EnvironmentSummary } from "@/lib/types";

interface ChatPanelProps {
  /** The environments of the status panel; the example requests are built from their names. */
  environments: EnvironmentSummary[] | null;
  /** Called when a change has finished, so the status panel can be refreshed. */
  onOperationFinished: () => void;
}

/** The conversation and, below it, the message box. */
export function ChatPanel({ environments, onOperationFinished }: ChatPanelProps) {
  const { items, isLoaded, isSending, isWorking, send, decide } = useConversation();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = buildSuggestions(environments ?? []);

  const scrollToNewest = useCallback(() => {
    const list = listRef.current;
    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, []);

  useEffect(scrollToNewest, [items, isWorking, scrollToNewest]);

  // The cursor is in the message box when the page opens and again after each answer.
  useEffect(() => {
    if (!isSending) {
      inputRef.current?.focus();
    }
  }, [isSending]);

  const handleOperationFinished = useCallback(() => {
    scrollToNewest();
    onOperationFinished();
  }, [scrollToNewest, onOperationFinished]);

  // A click on an example only fills the message box: the user can still change it before pressing Enter.
  const fillMessageBox = useCallback((example: string) => {
    setDraft(example);
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (message === "" || isSending) {
      return;
    }
    setDraft("");
    void send(message);
  }

  return (
    <Card role="region" aria-label="Conversation" className="min-h-0 gap-0 py-0">
      {/* New messages are announced to screen readers as they arrive. */}
      <div
        ref={listRef}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-smooth p-3.5 min-[861px]:p-5"
      >
        {isLoaded && items.length === 0 && <Welcome />}
        {/* The list only grows, so the position of a message is a stable key. */}
        {items.map((item, index) =>
          item.role === "user" ? (
            <UserMessage key={index} item={item} />
          ) : (
            <AgentMessage
              key={index}
              item={item}
              onDecide={decide}
              onSuggest={fillMessageBox}
              onOperationFinished={handleOperationFinished}
            />
          ),
        )}
        {isWorking && <WorkingMessage />}
      </div>

      <div className="grid gap-2 border-t p-3">
        {suggestions.length > 0 && (
          <div aria-label="Example requests" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs text-muted-foreground">Try</span>
            <SuggestionChips examples={suggestions} onPick={fillMessageBox} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Label htmlFor="message-input" className="sr-only">
            Message
          </Label>
          <Input
            id="message-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={500}
            placeholder='Ask Buddy, for example "is staging healthy?"'
            autoComplete="off"
            className="h-11 flex-1 rounded-xl bg-sunken px-3.5"
          />
          <Button type="submit" disabled={isSending} className="h-11 rounded-xl px-[18px]">
            Send
            <ArrowRight />
          </Button>
        </form>

        <p className="hidden text-xs text-muted-foreground min-[861px]:block">
          Nothing changes in the cluster until you click Confirm. Each browser tab has its own conversation.
        </p>
      </div>
    </Card>
  );
}
