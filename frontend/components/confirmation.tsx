import { cn } from "cn";
import { CircleAlert } from "lucide-react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ActionRequest } from "@/lib/types";

interface ConfirmationProps {
  action: ActionRequest;
  /** Why the buttons are switched off. Not set while the action is still open. */
  note?: string;
  onDecide: (choice: "confirm" | "cancel") => void;
}

/** Confirm and Cancel under a reply that proposes a change. Nothing changes until Confirm is clicked. */
export function Confirmation({ action, note, onDecide }: ConfirmationProps) {
  const isOpen = note === undefined;
  // The server sends a warning only for a protected environment such as prod.
  const isProtected = action.warning !== null;

  return (
    <div className="mt-2.5 border-t border-dashed border-input pt-2.5 font-sans">
      {isProtected && (
        <Alert className="mb-2.5 border-down-solid bg-down-soft text-down">
          <CircleAlert />
          <AlertTitle className="font-semibold">{action.warning}</AlertTitle>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!isOpen}
          onClick={() => onDecide("confirm")}
          // Red for a protected environment, so it cannot be clicked out of habit.
          className={cn(
            "h-[34px] px-3.5",
            isProtected && "bg-down-solid text-on-down hover:bg-down-solid hover:brightness-90",
          )}
        >
          Confirm
        </Button>
        <Button variant="outline" disabled={!isOpen} onClick={() => onDecide("cancel")} className="h-[34px] px-3.5">
          Cancel
        </Button>
        <span className="text-[12.5px] text-muted-foreground">{note}</span>
      </div>
    </div>
  );
}
