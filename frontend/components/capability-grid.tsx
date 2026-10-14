import { FolderUp, Gauge, HeartPulse, History, Layers, Rocket, SlidersHorizontal, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import type { Capability, CapabilityIcon } from "@/lib/capabilities";

const ICONS: Record<CapabilityIcon, LucideIcon> = {
  create: FolderUp,
  deploy: Rocket,
  rollback: Undo2,
  scale: Layers,
  health: HeartPulse,
  usage: Gauge,
  edit: SlidersHorizontal,
  history: History,
};

interface CapabilityGridProps {
  capabilities: Capability[];
  /** Called with the card's request. */
  onPick: (example: string) => void;
  className?: string;
}

/** What the assistant can do, as cards. A click puts the card's request in the message box. */
export function CapabilityGrid({ capabilities, onPick, className }: CapabilityGridProps) {
  return (
    <ul aria-label="What I can do" className={cn("grid gap-2 sm:grid-cols-2", className)}>
      {capabilities.map((capability, index) => {
        const Icon = ICONS[capability.icon];
        return (
          <li key={capability.icon} className="animate-line-in" style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
            <button
              type="button"
              onClick={() => onPick(capability.example)}
              title={capability.example}
              className="group flex h-full w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-soft focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:outline-none"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="grid gap-0.5">
                <span className="text-[13.5px] leading-snug font-semibold text-foreground">{capability.title}</span>
                <span className="text-[12.5px] leading-snug text-muted-foreground">{capability.description}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
