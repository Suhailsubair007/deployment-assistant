"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";

import { AgentMessage, UserMessage, WorkingMessage } from "@/components/message";
import { SuggestionChips } from "@/components/suggestion-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Welcome } from "@/components/welcome";
import { useConversation } from "@/hooks/use-conversation";
import { ASSISTANT_NAME } from "@/lib/constants";
import { buildSuggestions } from "@/lib/suggestions";
import type { EnvironmentSummary } from "@/lib/types";

// The conversation and the message box share one width and sit in the middle of their column,
// so a message never has to be read across the whole of a wide screen.
const COLUMN = "mx-auto w-full max-w-[860px]";

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
    <section aria-label="Conversation" className="flex min-h-0 flex-col gap-2">
      {/* This box scrolls. New messages are announced to screen readers as they arrive. */}
      <div ref={listRef} aria-live="polite" className="edge-fade min-h-0 flex-1 overflow-y-auto scroll-smooth">
        <div className={`${COLUMN} flex min-h-full flex-col gap-5 px-1 py-5 min-[861px]:px-3`}>
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
      </div>

      <div className={`${COLUMN} grid gap-2.5 px-1 min-[861px]:px-3`}>
        {suggestions.length > 0 && (
          <div aria-label="Example requests" className="flex animate-message-in flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs font-semibold text-muted-foreground">Try</span>
            <SuggestionChips examples={suggestions} onPick={fillMessageBox} />
          </div>
        )}

        {/* The frame around the box and the button lights up while the cursor is in the box. */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-2xl border bg-card p-1.5 pl-4 shadow-soft transition-[border-color,box-shadow] duration-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-ring/15"
        >
          <Label htmlFor="message-input" className="sr-only">
            Message
          </Label>
          <Input
            id="message-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={500}
            placeholder={`Ask ${ASSISTANT_NAME}, for example "is staging healthy?"`}
            autoComplete="off"
            // The frame above is the visible edge, so the box itself has none.
            className="h-10 flex-1 border-0 bg-transparent px-0 text-[15px] focus-visible:ring-0 md:text-[15px] dark:bg-transparent"
          />
          <Button type="submit" disabled={isSending} className="h-10 rounded-xl px-4">
            Send
            {/* While the answer is on its way the arrow is a spinner. */}
            {isSending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
          </Button>
        </form>

        <p className="hidden text-center text-xs text-muted-foreground min-[861px]:block">
          Nothing is built or changed until you click Confirm. Each browser tab has its own conversation.
        </p>
      </div>
    </section>
  );
}
