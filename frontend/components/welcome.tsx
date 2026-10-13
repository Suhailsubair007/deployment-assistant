import { Buddy } from "@/components/buddy";

/** What an empty conversation shows: Buddy says who it is and what it can do. */
export function Welcome() {
  return (
    <div className="m-auto flex max-w-[400px] animate-message-in flex-col items-center gap-2.5 py-6 text-center">
      <Buddy isLive className="mb-1 size-20" />
      <h2 className="text-xl font-semibold tracking-[-0.01em]">Hi, I&apos;m Buddy.</h2>
      <p className="text-[15px] leading-[1.55] text-muted-foreground">
        I deploy, roll back and scale your apps, and I tell you how they are doing. Pick an example below or ask in
        your own words.
      </p>
    </div>
  );
}
