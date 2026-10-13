"use client";

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Check } from "lucide-react";

import { Rollo } from "@/components/rollo";
import { SPLASH_FADE_MS, SPLASH_STAGES } from "@/lib/constants";
import type { SplashStage } from "@/lib/types";

/** The round spinner under the name. When the page is ready it becomes a green tick. */
function Spinner({ isReady }: { isReady: boolean }) {
  if (isReady) {
    return (
      <span className="grid size-7 animate-pop place-items-center rounded-full bg-healthy-solid text-white">
        <Check className="size-4" strokeWidth={3.5} />
      </span>
    );
  }
  return (
    // A faint full circle, and a quarter of it in the accent colour that goes round and round.
    <svg viewBox="0 0 28 28" strokeWidth="3" className="size-7 animate-spin fill-none">
      <circle cx="14" cy="14" r="11" className="stroke-muted" />
      <path d="M14 3a11 11 0 0 1 11 11" strokeLinecap="round" className="stroke-primary" />
    </svg>
  );
}

/** The screen shown while the page starts: the app's icon, its name, and a spinner that ends in a tick. */
export function Splash() {
  const [stage, setStage] = useState<SplashStage>("starting");

  useEffect(() => {
    const timers = SPLASH_STAGES.map((next) => setTimeout(() => setStage(next.stage), next.afterMs));
    return () => timers.forEach(clearTimeout);
  }, []);

  if (stage === "gone") {
    return null;
  }
  const isReady = stage !== "starting";

  return (
    // Decoration only, so screen readers skip it and reach the page underneath at once.
    <div
      aria-hidden="true"
      style={{ transitionDuration: `${SPLASH_FADE_MS}ms` }}
      className={cn(
        "splash page-glow fixed inset-0 z-50 grid place-items-center bg-background transition-[opacity,translate] ease-out",
        // While it fades out it also lifts a little, and clicks already go to the page.
        stage === "leaving" && "pointer-events-none -translate-y-4 opacity-0",
      )}
    >
      {/* The parts appear one after the other, from the top down. */}
      <div className="flex flex-col items-center px-6 text-center">
        <div className="relative animate-drop-in">
          {/* A soft light behind the icon that slowly gets weaker and stronger. */}
          <span className="absolute -inset-8 animate-pulse rounded-full bg-primary/25 blur-2xl" />
          {/* The app's icon: Rollo's face on a tile. Rollo thinks while the page starts and smiles when it is ready. */}
          <div className="relative grid size-28 place-items-center rounded-[30px] border bg-card shadow-soft">
            <Rollo isLive mood={isReady ? "happy" : "working"} className="size-[72px]" />
          </div>
        </div>

        <p
          className="mt-8 animate-message-in text-[30px] leading-tight font-extrabold tracking-[-0.03em]"
          style={{ animationDelay: "120ms" }}
        >
          Deployment Assistant
        </p>
        <p className="mt-1.5 animate-message-in text-[15px] text-muted-foreground" style={{ animationDelay: "200ms" }}>
          Create, deploy, roll back and check health by chat
        </p>

        <div className="mt-10 animate-message-in" style={{ animationDelay: "300ms" }}>
          <Spinner isReady={isReady} />
        </div>
        {/* A new key makes React draw the line again, so "Ready" rises in. */}
        <p key={String(isReady)} data-tone="healthy" className="mt-3 animate-line-in text-[13px] font-medium">
          {isReady ? <span className="text-tone">Ready</span> : <span className="text-shimmer">Starting up</span>}
        </p>
      </div>
    </div>
  );
}
