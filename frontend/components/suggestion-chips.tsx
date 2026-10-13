import { cn } from "cn";

import { Button } from "@/components/ui/button";

interface SuggestionChipsProps {
  examples: string[];
  /** Called with the request that was clicked. */
  onPick: (example: string) => void;
  /** Extra classes for each button, for example another background. */
  chipClassName?: string;
}

/** Example requests as small round buttons: under the message box, and in a reply that offers them. */
export function SuggestionChips({ examples, onPick, chipClassName }: SuggestionChipsProps) {
  return examples.map((example) => (
    <Button
      key={example}
      variant="outline"
      className={cn(
        "h-[26px] rounded-full bg-sunken px-2.5 text-[12.5px] font-normal text-muted-foreground duration-200 hover:-translate-y-px hover:border-primary hover:bg-accent hover:text-foreground",
        chipClassName,
      )}
      onClick={() => onPick(example)}
    >
      {example}
    </Button>
  ));
}
