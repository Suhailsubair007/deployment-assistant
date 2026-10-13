import type { CSSProperties } from "react";
import { cn } from "cn";

import { StatusPill } from "@/components/status-pill";
import { groupFacts, parseReply } from "@/lib/reply-lines";
import type { FactsLine, TextPart } from "@/lib/types";

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

/** Rows of facts as a table: one fact per cell, in the fixed-width font so numbers line up. */
function FactsTable({ rows, style }: { rows: FactsLine[]; style: CSSProperties }) {
  const first = rows[0];
  if (first === undefined) {
    return null;
  }
  return (
    <div
      className="my-1.5 max-w-full animate-line-in overflow-x-auto rounded-lg border bg-sunken"
      // The table stays indented as far as the server indented its rows.
      style={{ ...style, marginLeft: `${first.indent}ch` }}
    >
      <div
        className="grid w-max min-w-full font-mono text-[12.5px] leading-[1.6]"
        style={{ gridTemplateColumns: `repeat(${first.facts.length}, auto)` }}
      >
        {rows.map((row, rowIndex) =>
          row.facts.map((fact, factIndex) => (
            <div
              key={`${rowIndex}/${factIndex}`}
              className={cn("px-2.5 py-1.5 whitespace-nowrap", rowIndex > 0 && "border-t", factIndex > 0 && "border-l")}
            >
              <Parts parts={fact} />
            </div>
          )),
        )}
      </div>
    </div>
  );
}

/** Draws an agent reply piece by piece. */
export function ReplyText({ text }: { text: string }) {
  return groupFacts(parseReply(text)).map((block, index) => {
    // Each piece appears a moment after the one above it, so a long answer unfolds from the top.
    const style = { animationDelay: `${Math.min(index, 8) * 45}ms` };

    if (block.kind === "table") {
      return <FactsTable key={index} rows={block.rows} style={style} />;
    }

    const { line } = block;
    return (
      <div
        key={index}
        style={style}
        className={cn(
          // An empty line keeps its height.
          "min-h-[1lh] animate-line-in",
          line.isLead && "mb-0.5 font-semibold",
          line.kind === "note" && "mt-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[13px] text-muted-foreground",
          line.kind === "bullet" &&
            "relative pl-4 before:absolute before:top-[calc(0.5lh-2.5px)] before:left-1 before:size-[5px] before:rounded-full before:bg-primary",
        )}
      >
        <Parts parts={line.parts} />
      </div>
    );
  });
}
