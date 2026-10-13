"use client";

import { useEffect, useState } from "react";
import { Contrast } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readUserName, saveUserName } from "@/lib/identity";

// On the dark bar the normal accent is too dim for a focus ring.
const FOCUS_ON_INK = "focus-visible:border-[#8ab5ff] focus-visible:ring-[#8ab5ff]/40";

/** The name stored as "requested by" with every change. It is the same in every tab. */
function NameField() {
  const [name, setName] = useState("");

  // The saved name is in the browser's storage, which does not exist while the page is built.
  useEffect(() => {
    setName(readUserName());
  }, []);

  return (
    <div
      className="flex items-center gap-2"
      title='Saved with every change as "requested by" in the deployment history'
    >
      {/* On a narrow screen the label is out of sight, but still read out as the label of the box. */}
      <Label htmlFor="user-name" className="text-[12.5px] font-normal whitespace-nowrap text-on-ink-muted max-[520px]:sr-only">
        Deploying as
      </Label>
      <Input
        id="user-name"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          saveUserName(event.target.value);
        }}
        maxLength={40}
        placeholder="anonymous"
        autoComplete="nickname"
        className={`h-8 w-[110px] border-white/20 bg-white/10 text-on-ink placeholder:text-on-ink-muted min-[521px]:w-[150px] dark:bg-white/10 ${FOCUS_ON_INK}`}
      />
    </div>
  );
}

/** Switches between the light and the dark theme. Without a saved choice the system setting decides. */
function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known in the browser, so the label is filled in once the page runs there.
  const [isInBrowser, setIsInBrowser] = useState(false);
  useEffect(() => {
    setIsInBrowser(true);
  }, []);

  const other = resolvedTheme === "dark" ? "light" : "dark";
  const label = isInBrowser ? `Switch to the ${other} theme` : "Switch theme";

  return (
    <Button
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      onClick={() => setTheme(other)}
      className={`border-white/20 text-on-ink hover:bg-white/10 hover:text-on-ink dark:hover:bg-white/10 ${FOCUS_ON_INK}`}
    >
      <Contrast />
    </Button>
  );
}

/** The dark bar on top: what this is, who is deploying, and the theme button. */
export function Header() {
  return (
    <header className="flex min-h-14 items-center justify-between gap-4 border-b bg-ink px-3 py-2 text-on-ink min-[521px]:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {/* Three pods, two of them ready: the same picture a rollout draws in the chat. */}
        <svg viewBox="0 0 34 10" aria-hidden="true" className="w-[34px] flex-none fill-on-ink">
          <rect width="10" height="10" rx="3" />
          <rect x="12" width="10" height="10" rx="3" />
          <rect x="24.75" y="0.75" width="8.5" height="8.5" rx="2.5" strokeWidth="1.5" className="fill-none stroke-on-ink-muted" />
        </svg>
        <div>
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Deployment Assistant</h1>
          <p className="hidden text-xs text-on-ink-muted min-[861px]:block">Deploy, roll back and check health by chat</p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <NameField />
        <ThemeButton />
      </div>
    </header>
  );
}
