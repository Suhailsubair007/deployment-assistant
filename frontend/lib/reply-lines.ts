// Agent replies are plain text. This file cuts a reply into lines and parts, so the page
// can give three patterns their own look without the server sending any HTML:
// "- " starts a list item, "Note: " a side note, and " | " separates facts.
// The words HEALTHY, DEGRADED and DOWN become coloured labels, and rows of facts become tables.

export type HealthWord = "HEALTHY" | "DEGRADED" | "DOWN";

export type TextPart = { kind: "text"; text: string } | { kind: "status"; status: HealthWord };

export type ReplyLine =
  | { kind: "plain" | "note" | "bullet"; isLead: boolean; parts: TextPart[] }
  | { kind: "facts"; isLead: boolean; indent: number; facts: TextPart[][] };

// The brackets make split() keep the matched word; \b stops a match inside "SHUTDOWN".
const STATUS_WORDS = /\b(HEALTHY|DEGRADED|DOWN)\b/;

function isHealthWord(word: string): word is HealthWord {
  return word === "HEALTHY" || word === "DEGRADED" || word === "DOWN";
}

/** Cuts text into plain parts and status words. */
export function splitStatusWords(text: string): TextPart[] {
  const parts: TextPart[] = [];
  for (const piece of text.split(STATUS_WORDS)) {
    if (isHealthWord(piece)) {
      parts.push({ kind: "status", status: piece });
    } else if (piece !== "") {
      parts.push({ kind: "text", text: piece });
    }
  }
  return parts;
}

/** Cuts a reply into lines and says how each one is drawn. */
export function parseReply(text: string): ReplyLine[] {
  const lines = text.split("\n");
  return lines.map((line, index): ReplyLine => {
    // The first line of a longer reply is its headline.
    const isLead = index === 0 && lines.length > 1;
    if (line.startsWith("- ")) {
      return { kind: "bullet", isLead, parts: splitStatusWords(line.slice(2)) };
    }
    if (line.includes(" | ")) {
      // Spaces at the start become an indent of the whole row, so facts that wrap stay under it.
      const content = line.trimStart();
      const indent = line.length - content.length;
      return { kind: "facts", isLead, indent, facts: content.split(" | ").map(splitStatusWords) };
    }
    return { kind: line.startsWith("Note: ") ? "note" : "plain", isLead, parts: splitStatusWords(line) };
  });
}

export type FactsLine = Extract<ReplyLine, { kind: "facts" }>;
export type TextLine = Exclude<ReplyLine, FactsLine>;

/** A piece of a reply as the page draws it: one line of text, or a table of facts. */
export type ReplyBlock = { kind: "line"; line: TextLine } | { kind: "table"; rows: FactsLine[] };

/**
 * Puts rows of facts that follow each other into one table, so their columns line up.
 * Rows belong together when they have the same number of facts and the same indent.
 */
export function groupFacts(lines: ReplyLine[]): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  for (const line of lines) {
    if (line.kind !== "facts") {
      blocks.push({ kind: "line", line });
      continue;
    }
    const previous = blocks.at(-1);
    const first = previous?.kind === "table" ? previous.rows[0] : undefined;
    if (previous?.kind === "table" && first?.facts.length === line.facts.length && first.indent === line.indent) {
      previous.rows.push(line);
    } else {
      blocks.push({ kind: "table", rows: [line] });
    }
  }
  return blocks;
}
