// A pretend cluster for unit tests. It keeps deployments and pods in memory, records
// every change it is asked to make, and plays out a rollout one step per poll.

import type {
  ClusterGateway,
  DeploymentInfo,
  EventInfo,
  HealthProbe,
  Manifest,
  NodeInfo,
  NodeUsage,
  PodInfo,
  PodUsage,
} from "@/types/cluster.ts";
import { NotFoundError } from "@/errors.ts";

/** What the new pods do after a change. "frozen" leaves the pods exactly as the test arranged them. */
export type RolloutBehaviour = "succeed" | "stall" | "imageNotFound" | "crashLoop" | "frozen";

interface FakeDeployment {
  name: string;
  namespace: string;
  image: string;
  desiredReplicas: number;
}

const RESOURCES = {
  requests: { cpu: "100m", memory: "128Mi" },
  limits: { cpu: "500m", memory: "256Mi" },
};

export class FakeGateway implements ClusterGateway {
  /** Every change sent to the cluster, in order, for example "applyDeployment staging sample-app:v2 x3". */
  writes: string[] = [];
  namespaces = new Set(["staging", "prod"]);
  rollout: RolloutBehaviour = "succeed";
  health: HealthProbe = { ok: true, statusCode: 200, responseMs: 62 };
  nodes: NodeInfo[] = [
    { name: "node-1", ready: true, memoryPressure: false, diskPressure: false, allocatable: { cpu: "4", memory: "8Gi" } },
  ];
  nodeUsage: NodeUsage[] = [{ nodeName: "node-1", cpu: "1640m", memory: "5161Mi" }];
  /** Usage per pod name. A pod that is not listed has no metrics yet. */
  podUsage = new Map<string, { cpu: string; memory: string }>();
  /** Set this to make metrics calls fail, as they do when metrics-server is missing. */
  metricsError: Error | null = null;
  events = new Map<string, EventInfo[]>();
  logs = new Map<string, string[]>();

  private readonly failures = new Map<string, Error>();
  private readonly deployments = new Map<string, FakeDeployment>();
  private readonly pods = new Map<string, PodInfo[]>();
  private podCounter = 0;

  // ---- Arranging the cluster in a test ----

  /** Puts an app into the cluster as if it had been deployed earlier, with every pod ready. */
  seed(namespace: string, name: string, image: string, replicas: number): void {
    const deployment = { name, namespace, image, desiredReplicas: replicas };
    this.deployments.set(`${namespace}/${name}`, deployment);
    const pods = Array.from({ length: replicas }, () => this.newPod(deployment, {}));
    this.pods.set(`${namespace}/${name}`, pods);
  }

  /** Replaces the pods of an app, for tests that need an unusual pod state. */
  setPods(namespace: string, name: string, pods: PodInfo[]): void {
    this.pods.set(`${namespace}/${name}`, pods);
  }

  /** Builds a pod of the app's current image; `overrides` change any part of it. */
  podOf(namespace: string, name: string, overrides: Partial<PodInfo>): PodInfo {
    const deployment = this.deployments.get(`${namespace}/${name}`);
    if (deployment === undefined) {
      throw new Error(`Seed ${namespace}/${name} before building pods for it.`);
    }
    return this.newPod(deployment, overrides);
  }

  /** Makes the next call of one gateway method fail with this error. */
  failNext(method: keyof ClusterGateway, error: Error): void {
    this.failures.set(method, error);
  }

  // ---- ClusterGateway ----

  contextName(): string {
    return "fake-cluster";
  }

  clusterName(): string {
    return "fake-cluster";
  }

  async namespaceExists(namespace: string): Promise<boolean> {
    this.throwIfTold("namespaceExists");
    return this.namespaces.has(namespace);
  }

  async getDeployment(namespace: string, name: string): Promise<DeploymentInfo | null> {
    this.throwIfTold("getDeployment");
    const deployment = this.deployments.get(`${namespace}/${name}`);
    if (deployment === undefined) {
      return null;
    }
    const pods = this.pods.get(`${namespace}/${name}`) ?? [];
    const ready = pods.filter((pod) => pod.ready).length;
    return {
      name,
      namespace,
      image: deployment.image,
      desiredReplicas: deployment.desiredReplicas,
      updatedReplicas: pods.filter((pod) => pod.image === deployment.image).length,
      readyReplicas: ready,
      availableReplicas: ready,
      rolloutObserved: true,
    };
  }

  async applyDeployment(namespace: string, manifest: Manifest): Promise<void> {
    this.throwIfTold("applyDeployment");
    this.requireNamespace(namespace);
    const spec = manifest.spec as { replicas: number; template: { spec: { containers: { image: string }[] } } };
    const image = spec.template.spec.containers[0]?.image ?? "";
    const name = manifest.metadata.name;
    this.deployments.set(`${namespace}/${name}`, { name, namespace, image, desiredReplicas: spec.replicas });
    this.writes.push(`applyDeployment ${namespace} ${image} x${spec.replicas}`);
  }

  async applyService(namespace: string, manifest: Manifest): Promise<void> {
    this.throwIfTold("applyService");
    this.requireNamespace(namespace);
    this.writes.push(`applyService ${namespace} ${manifest.metadata.name}`);
  }

  async listPods(namespace: string, appLabel: string): Promise<PodInfo[]> {
    this.throwIfTold("listPods");
    this.advanceRollout(`${namespace}/${appLabel}`);
    return [...(this.pods.get(`${namespace}/${appLabel}`) ?? [])];
  }

  async listPodEvents(_namespace: string, podName: string): Promise<EventInfo[]> {
    this.throwIfTold("listPodEvents");
    return this.events.get(podName) ?? [];
  }

  async tailPodLog(_namespace: string, podName: string, lines: number): Promise<string[]> {
    this.throwIfTold("tailPodLog");
    return (this.logs.get(podName) ?? []).slice(-lines);
  }

  async listPodMetrics(namespace: string): Promise<PodUsage[]> {
    this.throwIfTold("listPodMetrics");
    if (this.metricsError !== null) {
      throw this.metricsError;
    }
    const usage: PodUsage[] = [];
    for (const [key, pods] of this.pods) {
      if (!key.startsWith(`${namespace}/`)) {
        continue;
      }
      for (const pod of pods) {
        const used = this.podUsage.get(pod.name);
        if (used !== undefined) {
          usage.push({ podName: pod.name, containers: [{ name: "app", ...used }] });
        }
      }
    }
    return usage;
  }

  async listNodes(): Promise<NodeInfo[]> {
    this.throwIfTold("listNodes");
    return this.nodes;
  }

  async listNodeMetrics(): Promise<NodeUsage[]> {
    this.throwIfTold("listNodeMetrics");
    if (this.metricsError !== null) {
      throw this.metricsError;
    }
    return this.nodeUsage;
  }

  async getServiceHealth(): Promise<HealthProbe> {
    this.throwIfTold("getServiceHealth");
    return this.health;
  }

  // ---- Internals ----

  private throwIfTold(method: string): void {
    const error = this.failures.get(method);
    if (error !== undefined) {
      this.failures.delete(method);
      throw error;
    }
  }

  private requireNamespace(namespace: string): void {
    if (!this.namespaces.has(namespace)) {
      throw new NotFoundError(`Namespace "${namespace}" does not exist in this cluster.`, "namespaces");
    }
  }

  private newPod(deployment: FakeDeployment, overrides: Partial<PodInfo>): PodInfo {
    this.podCounter += 1;
    const version = deployment.image.split(":").at(-1);
    return {
      name: `${deployment.name}-${version}-${this.podCounter}`,
      phase: "Running",
      ready: true,
      restarts: 0,
      image: deployment.image,
      createdAt: new Date("2026-10-12T10:00:00Z"),
      containers: [{ name: deployment.name, ...RESOURCES }],
      ...overrides,
    };
  }

  /** Moves a rollout forward by one step. Called on every pod listing, like one tick of a clock. */
  private advanceRollout(key: string): void {
    const deployment = this.deployments.get(key);
    if (deployment === undefined || this.rollout === "frozen") {
      return;
    }
    const pods = this.pods.get(key) ?? [];
    const isNew = (pod: PodInfo): boolean => pod.image === deployment.image;
    const newPods = pods.filter(isNew);

    if (this.rollout === "succeed") {
      const readyNew = newPods.filter((pod) => pod.ready).length;
      if (readyNew < deployment.desiredReplicas) {
        // One new pod becomes ready and takes the place of one old pod.
        const oldIndex = pods.findIndex((pod) => !isNew(pod));
        if (oldIndex !== -1) {
          pods.splice(oldIndex, 1);
        }
        pods.push(this.newPod(deployment, {}));
        this.pods.set(key, pods);
      } else {
        // Finished: old pods and pods beyond the wanted count are gone.
        this.pods.set(key, newPods.slice(0, deployment.desiredReplicas));
      }
      return;
    }

    // In the failing behaviours one new pod appears and never becomes ready. Old pods stay.
    if (newPods.length > 0 && newPods.some((pod) => !pod.ready)) {
      return;
    }
    if (this.rollout === "stall") {
      pods.push(
        this.newPod(deployment, {
          phase: "Pending",
          ready: false,
          unschedulableMessage: "0/1 nodes are available: 1 Insufficient memory.",
        }),
      );
    } else if (this.rollout === "imageNotFound") {
      pods.push(this.newPod(deployment, { phase: "Pending", ready: false, waitingReason: "ImagePullBackOff" }));
    } else {
      const crashing = this.newPod(deployment, {
        ready: false,
        restarts: 3,
        waitingReason: "CrashLoopBackOff",
        lastTerminationReason: "Error",
        lastExitCode: 1,
      });
      this.logs.set(crashing.name, ["starting", "Fatal: cannot read /etc/app/config.json"]);
      pods.push(crashing);
    }
    this.pods.set(key, pods);
  }
}
