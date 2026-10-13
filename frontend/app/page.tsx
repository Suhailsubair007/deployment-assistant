"use client";

import { ChatPanel } from "@/components/chat-panel";
import { Header } from "@/components/header";
import { StatusPanel } from "@/components/status-panel";
import { useEnvironmentStatus } from "@/hooks/use-environment-status";

export default function Page() {
  const status = useEnvironmentStatus();

  return (
    <>
      <Header />
      {/* The conversation on the left, the status panel on the right. On a small screen: one column. */}
      <main className="mx-auto grid min-h-0 w-full max-w-[1320px] flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 min-[861px]:grid-cols-[minmax(0,1fr)_340px] min-[861px]:grid-rows-[minmax(0,1fr)] min-[861px]:gap-5 min-[861px]:p-4">
        <ChatPanel environments={status.environments} onOperationFinished={status.refresh} />
        <StatusPanel status={status} />
      </main>
    </>
  );
}
