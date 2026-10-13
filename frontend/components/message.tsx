import { cn } from "cn";

import { Confirmation } from "@/components/confirmation";
import { ReplyText } from "@/components/reply-text";
import { Rollout } from "@/components/rollout";
import type { ChatItem } from "@/lib/conversation";

/** "18:42" */
function formatClock(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Meta({ author, at }: { author: string; at: string }) {
  return (
    <div className="flex gap-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{author}</span>
      <time dateTime={at}>{formatClock(at)}</time>
    </div>
  );
}

// Agent replies are data, so they use the fixed-width font: numbers line up.
const AGENT_BUBBLE =
  "max-w-full rounded-[4px_14px_14px_14px] border bg-sunken px-[13px] py-[9px] font-mono text-[13px] leading-[1.6] [overflow-wrap:anywhere]";

export function UserMessage({ item }: { item: ChatItem }) {
  return (
    <div className="flex max-w-[min(85%,640px)] flex-col items-end gap-1 self-end">
      <Meta author="You" at={item.at} />
      <div className="max-w-full rounded-[14px_14px_4px_14px] bg-accent px-[13px] py-[9px] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {item.text}
      </div>
    </div>
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
  return (
    <div className="flex max-w-full flex-col items-start gap-1 self-start">
      <Meta author="Assistant" at={item.at} />
      <div className={cn(AGENT_BUBBLE, item.isError && "border-down-solid bg-down-soft")}>
        <ReplyText text={item.text} />
        {action !== undefined && (
          <Confirmation action={action} note={item.actionNote} onDecide={(choice) => onDecide(action.id, choice)} />
        )}
        {operationId !== undefined && <Rollout operationId={operationId} onFinished={onOperationFinished} />}
      </div>
    </div>
  );
}

/** Shown while the server is working on an answer. */
export function WorkingMessage() {
  return (
    <div className={cn(AGENT_BUBBLE, "flex items-center gap-2 self-start font-sans text-muted-foreground")}>
      Working on it
      <span className="flex gap-[3px]">
        {[0, 0.15, 0.3].map((delay) => (
          <span
            key={delay}
            className="size-[5px] animate-dot rounded-full bg-current"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
    </div>
  );
}
