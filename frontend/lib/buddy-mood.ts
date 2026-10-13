// Buddy is the face of the assistant. Its face follows what a reply says,
// so a problem can be seen before a word is read.

import { splitStatusWords } from "./reply-lines.ts";

/** How Buddy looks: resting, busy, pleased after good news, or uneasy after a problem. */
export type BuddyMood = "idle" | "working" | "happy" | "worried";

/** Buddy's face next to a reply. Only the headline counts: it carries the overall status. */
export function moodOfReply(text: string, isError: boolean): BuddyMood {
  if (isError) {
    return "worried";
  }
  const headline = text.split("\n")[0] ?? "";
  for (const part of splitStatusWords(headline)) {
    if (part.kind === "status") {
      return part.status === "HEALTHY" ? "happy" : "worried";
    }
  }
  return "idle";
}
