// Turns the state of a pod into one plain sentence that says why it is not working.

import type { ClusterGateway, EventInfo, PodInfo } from "../cluster/gateway.ts";

const IMAGE_PROBLEMS = new Set(["ImagePullBackOff", "ErrImagePull", "InvalidImageName"]);
/** Waiting reasons a new pod passes through on its way up. They are not problems. */
export const NORMAL_STARTUP = new Set(["ContainerCreating", "PodInitializing"]);

const LOG_LINES_TO_READ = 5;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Ends the text with a full stop unless it already ends a sentence, so more text can follow it. */
function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Explains what is wrong with a pod, or returns null when nothing is.
 *
 * @param logTail the pod's last log lines, oldest first (may be empty)
 * @param events  events about the pod, oldest first (may be empty)
 */
export function explainPod(pod: PodInfo, logTail: string[], events: EventInfo[] = []): string | null {
  // 1. No node has room for the pod.
  if (pod.unschedulableMessage) {
    if (pod.unschedulableMessage.includes("Insufficient memory")) {
      return "Pending: not enough memory on the nodes.";
    }
    if (pod.unschedulableMessage.includes("Insufficient cpu")) {
      return "Pending: not enough CPU on the nodes.";
    }
    return asSentence(`Pending: ${pod.unschedulableMessage}`);
  }

  // 2. The image cannot be downloaded.
  if (pod.waitingReason && IMAGE_PROBLEMS.has(pod.waitingReason)) {
    return `Image ${pod.image} was not found, or the cluster is not allowed to pull it.`;
  }

  // 3. The container starts, exits, and is restarted again and again.
  if (pod.waitingReason === "CrashLoopBackOff") {
    const facts = `${plural(pod.restarts, "restart")}, exit code ${pod.lastExitCode ?? "unknown"}`;
    const lastLine = logTail.at(-1);
    return lastLine
      ? `Container keeps crashing (${facts}). Last log line: "${lastLine}".`
      : `Container keeps crashing (${facts}).`;
  }

  // 4. Any other reason Kubernetes gives for not starting the container.
  if (pod.waitingReason && !NORMAL_STARTUP.has(pod.waitingReason)) {
    const detail = pod.waitingMessage ? `: ${pod.waitingMessage}` : "";
    return asSentence(`Cannot start (${pod.waitingReason})${detail}`);
  }

  // 5. The container was killed for going over its memory limit.
  if (pod.lastTerminationReason === "OOMKilled") {
    return `Killed for using more memory than its limit (OOMKilled); restarted ${plural(pod.restarts, "time")}.`;
  }

  // 6. It restarted for some other reason.
  if (pod.restarts > 0 && pod.lastTerminationReason) {
    return `Restarted ${plural(pod.restarts, "time")}; last exit: ${pod.lastTerminationReason} (exit code ${pod.lastExitCode ?? "unknown"}).`;
  }

  // 7. Running but not ready, usually a failing readiness probe. Only events say why.
  if (pod.phase === "Running" && !pod.ready) {
    const lastWarning = events.filter((event) => event.type === "Warning").at(-1);
    if (lastWarning) {
      return asSentence(`Not ready: ${lastWarning.message}`);
    }
  }

  return null;
}

/** Collects the log lines and events a pod's explanation needs, then explains it. */
export class FailureExplainer {
  private readonly gateway: ClusterGateway;

  constructor(gateway: ClusterGateway) {
    this.gateway = gateway;
  }

  async explain(namespace: string, pod: PodInfo): Promise<string | null> {
    let logTail: string[] = [];
    if (pod.waitingReason === "CrashLoopBackOff") {
      // The crash happened in the container that ran before the latest restart.
      logTail = await this.gateway.tailPodLog(namespace, pod.name, LOG_LINES_TO_READ, true);
      if (logTail.length === 0) {
        logTail = await this.gateway.tailPodLog(namespace, pod.name, LOG_LINES_TO_READ, false);
      }
    }
    let events: EventInfo[] = [];
    if (pod.phase === "Running" && !pod.ready) {
      events = await this.gateway.listPodEvents(namespace, pod.name);
    }
    return explainPod(pod, logTail, events);
  }

  /** Explains the first pod in the list that has a problem, or returns null when none has. */
  async explainFirstProblem(namespace: string, pods: PodInfo[]): Promise<string | null> {
    for (const pod of pods) {
      const explanation = await this.explain(namespace, pod);
      if (explanation !== null) {
        return explanation;
      }
    }
    return null;
  }
}
