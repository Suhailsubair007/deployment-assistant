"use client";

import { useEffect, useState } from "react";
import { Contrast } from "lucide-react";
import { useTheme } from "next-themes";

import { Rollo } from "@/components/rollo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSISTANT_NAME } from "@/lib/constants";
import { readUserName, saveUserName } from "@/lib/identity";

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
      <Label htmlFor="user-name" className="text-[12.5px] font-normal whitespace-nowrap text-muted-foreground max-[520px]:sr-only">
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
        className="h-9 w-[110px] bg-card min-[521px]:w-[150px]"
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
      variant="outline"
      size="icon"
      title={label}
      aria-label={label}
      onClick={() => setTheme(other)}
      className="size-9 bg-card"
    >
      <Contrast />
    </Button>
  );
}

/** The bar on top: what this is, who is deploying, and the theme button. */
export function Header() {
  return (
    // The bar is a little see-through, so the glow at the top of the page shows behind it.
    <header className="flex min-h-[60px] items-center justify-between gap-4 border-b bg-card/60 px-3 py-2 backdrop-blur-md min-[521px]:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-xl bg-accent">
          <Rollo isLive className="size-7" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold tracking-[-0.015em]">Deployment Assistant</h1>
          <p className="hidden text-xs text-muted-foreground min-[861px]:block">
            {ASSISTANT_NAME} deploys, rolls back and checks health by chat
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <NameField />
        <ThemeButton />
      </div>
    </header>
  );
}
