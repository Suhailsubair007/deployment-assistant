import { splitStatusWords } from "@/lib/reply-lines.ts";
import type { BuddyMood } from "@/lib/types.ts";

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
