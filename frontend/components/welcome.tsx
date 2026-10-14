import { CapabilityGrid } from "@/components/capability-grid";
import { Rollo } from "@/components/rollo";
import type { Capability } from "@/lib/capabilities";
import { ASSISTANT_NAME } from "@/lib/constants";

interface WelcomeProps {
  capabilities: Capability[];
  /** Called with the request of the card that was clicked. */
  onPick: (example: string) => void;
}

/** What an empty conversation shows: Rollo says who it is, and cards show what it can do. */
export function Welcome({ capabilities, onPick }: WelcomeProps) {
  return (
    <div className="m-auto flex w-full max-w-[640px] flex-col items-center py-6 text-center">
      {/* Rollo lands first, then the two lines of text rise in one after the other. */}
      <div className="animate-drop-in">
        <Rollo hasBody isLive className="h-36 w-[103px]" />
      </div>
      {/* Rollo's shadow on the floor. It gets smaller while Rollo floats up. */}
      <div aria-hidden="true" className="mt-1.5 h-2 w-16 animate-shadow rounded-[50%] bg-foreground/15 blur-[2px]" />
      <h2
        className="mt-5 animate-message-in text-[28px] leading-tight font-extrabold tracking-[-0.025em]"
        style={{ animationDelay: "140ms" }}
      >
        Hi, I&apos;m {ASSISTANT_NAME}.
      </h2>
      <p
        className="mt-2 animate-message-in text-[15px] leading-[1.6] text-muted-foreground"
        style={{ animationDelay: "220ms" }}
      >
        I put your apps online, keep them running and tell you how they are doing. Pick something to start, or ask
        in your own words.
      </p>
      <CapabilityGrid
        capabilities={capabilities}
        onPick={onPick}
        className="mt-6 w-full animate-message-in"
      />
    </div>
  );
}
