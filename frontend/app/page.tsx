"use client";

// The one page of the app. It only talks to our own web API; it knows nothing about Kubernetes.
// "use client" means these components run in the browser: the conversation belongs to one tab.

import { ChatPanel } from "@/components/chat-panel";
import { Header } from "@/components/header";
import { StatusPanel } from "@/components/status-panel";
import { useEnvironmentStatus } from "@/hooks/use-environment-status";

export default function Page() {
  // The status lives here because both halves use it: the panel shows it, and the chat
  // refreshes it when a change has finished.
  const status = useEnvironmentStatus();

  return (
    <>
      <Header />
      {/* The conversation on the left, the status panel on the right. On a small screen: one column. */}
      <main className="mx-auto grid min-h-0 w-full max-w-[1320px] flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-3 p-3 min-[861px]:grid-cols-[minmax(0,1fr)_330px] min-[861px]:grid-rows-[minmax(0,1fr)] min-[861px]:gap-4 min-[861px]:p-4">
        <ChatPanel environments={status.environments} onOperationFinished={status.refresh} />
        <StatusPanel status={status} />
      </main>
    </>
  );
}
