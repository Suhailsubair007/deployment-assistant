import { cn } from "cn";

import { StatusPill } from "@/components/status-pill";
import { parseReply } from "@/lib/reply-lines";
import type { TextPart } from "@/lib/reply-lines";

const TONE_OF_WORD = { HEALTHY: "healthy", DEGRADED: "degraded", DOWN: "down" } as const;

function Parts({ parts }: { parts: TextPart[] }) {
  return parts.map((part, index) =>
    part.kind === "status" ? (
      <StatusPill key={index} tone={TONE_OF_WORD[part.status]}>
        {part.status}
      </StatusPill>
    ) : (
      part.text
    ),
  );
}

/**
 * Draws an agent reply line by line. React writes every piece as text, never as HTML,
 * so a log line or pod name can never be run by the browser.
 */
export function ReplyText({ text }: { text: string }) {
  return parseReply(text).map((line, index) => {
    // One line of a reply. The server's own spaces are kept, and an empty line keeps its height.
    const lineClass = cn("min-h-[1lh] whitespace-pre-wrap", line.isLead && "font-semibold");

    if (line.kind === "facts") {
      // Facts sit side by side with a thin divider after each one. A row that is too long
      // wraps between facts, not inside one, and stays indented as far as the line was.
      return (
        <div key={index} className={cn(lineClass, "flex flex-wrap")} style={{ paddingLeft: `${line.indent}ch` }}>
          {line.facts.map((fact, factIndex) => (
            <span key={factIndex} className="not-last:mr-2.5 not-last:border-r not-last:border-input not-last:pr-2.5">
              <Parts parts={fact} />
            </span>
          ))}
        </div>
      );
    }

    return (
      <div
        key={index}
        className={cn(
          lineClass,
          line.kind === "note" && "text-muted-foreground",
          line.kind === "bullet" &&
            "relative pl-4 before:absolute before:top-[calc(0.5lh-2px)] before:left-1 before:size-[5px] before:rounded-full before:bg-muted-foreground",
        )}
      >
        <Parts parts={line.parts} />
      </div>
    );
  });
}
