import { styleText } from "node:util";

import type { StartupFacts } from "@/types/server.ts";

// styleText is Node's own way to colour terminal text. It leaves the colours out by itself
// when the output is not a terminal (a log file, a pipe) or when NO_COLOR is set.

/** One fact: a green arrow, the label in bold, then the value. */
function factLine(label: string, value: string): string {
  return `  ${styleText("green", "➜")}  ${styleText("bold", label)}  ${value}`;
}

/**
 * What the server prints once it is listening. The layout is the one Vite and Next.js use:
 * a title, one line per fact with the values lined up, then a note and any warnings.
 */
export function formatStartupBanner(facts: StartupFacts): string {
  const rows: [label: string, value: string][] = [
    ["Local:", styleText("cyan", facts.url)],
    ["Kubernetes context:", facts.context],
    ["Environments:", facts.environments.join(", ")],
  ];
  // Every label is padded to the longest one, so the values start in the same column.
  const width = Math.max(...rows.map(([label]) => label.length));

  return [
    "",
    `  ${styleText(["bold", "green"], "Deployment Assistant")} ${styleText("dim", "is running")}`,
    "",
    ...rows.map(([label, value]) => factLine(label.padEnd(width), value)),
    "",
    `  ${styleText("blue", "ℹ")}  ${facts.reader}`,
    ...facts.warnings.map((warning) => styleText("yellow", `  ⚠  ${warning}`)),
    "",
  ].join("\n");
}

/** A problem that stopped the server from starting, as one red line. It is printed to the error output. */
export function formatStartupError(message: string): string {
  return styleText("red", `\n  ✖  ${message}\n`, { stream: process.stderr });
}
