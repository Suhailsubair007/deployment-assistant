/** CPU and memory as Kubernetes writes them, for example "100m" and "128Mi". Missing when not set. */
export interface ResourceQuantities {
  cpu?: string;
  memory?: string;
}

export interface ContainerResources {
  name: string;
  requests: ResourceQuantities;
  limits: ResourceQuantities;
}

export interface DeploymentInfo {
  name: string;
  namespace: string;
  /** Image of the first container, for example "sample-app:v2". */
  image: string;
  /** How many pods we asked for. */
  desiredReplicas: number;
  /** Pods already running the newest version. */
  updatedReplicas: number;
  readyReplicas: number;
  /** Pods that are ready and have stayed ready long enough to count. */
  availableReplicas: number;
  /** False right after a change, until Kubernetes has started acting on it. */
  rolloutObserved: boolean;
}

export interface PodInfo {
  name: string;
  /** Pending, Running, Succeeded, Failed or Unknown. */
  phase: string;
  ready: boolean;
  restarts: number;
  image: string;
  createdAt: Date;
  containers: ContainerResources[];
  /** Why a container is waiting, for example "CrashLoopBackOff" or "ImagePullBackOff". */
  waitingReason?: string;
  waitingMessage?: string;
  /** How a container last ended, for example "OOMKilled" or "Error". */
  lastTerminationReason?: string;
  lastExitCode?: number;
  lastTerminatedAt?: Date;
  /** Set when the scheduler cannot place the pod, for example "1 Insufficient memory". */
  unschedulableMessage?: string;
}

export interface EventInfo {
  /** "Normal" or "Warning". */
  type: string;
  reason: string;
  message: string;
  at: Date | null;
}

/** Current usage of one pod, per container, as the metrics API reports it. */
export interface PodUsage {
  podName: string;
  containers: { name: string; cpu: string; memory: string }[];
}

export interface NodeInfo {
  name: string;
  ready: boolean;
  memoryPressure: boolean;
  diskPressure: boolean;
  /** What the node can hand out to pods. */
  allocatable: { cpu: string; memory: string };
}

export interface NodeUsage {
  nodeName: string;
  cpu: string;
  memory: string;
}

/** Result of one GET /health call through the Service. */
export interface HealthProbe {
  ok: boolean;
  /** HTTP status, or null when there was no answer at all. */
  statusCode: number | null;
  responseMs: number;
}

/** A Deployment or Service ready to send to Kubernetes. */
export interface Manifest {
  metadata: { name: string };
  [field: string]: unknown;
}

export interface ClusterGateway {
  /** Name of the kubeconfig context in use, for messages. */
  contextName(): string;
  /** Name of the cluster that context points to. Two contexts (two logins) can share one cluster. */
  clusterName(): string;
  namespaceExists(namespace: string): Promise<boolean>;

  /** Returns null when the deployment does not exist. */
  getDeployment(namespace: string, name: string): Promise<DeploymentInfo | null>;
  /** Creates the Deployment, or replaces it when it already exists. */
  applyDeployment(namespace: string, manifest: Manifest): Promise<void>;
  /** Creates the Service, or replaces it when it already exists. */
  applyService(namespace: string, manifest: Manifest): Promise<void>;

  /** Pods carrying the label app=<appLabel>. */
  listPods(namespace: string, appLabel: string): Promise<PodInfo[]>;
  listPodEvents(namespace: string, podName: string): Promise<EventInfo[]>;
  /** Last lines of the pod's log. `previous` reads the container that ran before the last restart. */
  tailPodLog(namespace: string, podName: string, lines: number, previous: boolean): Promise<string[]>;

  /** Throws MetricsUnavailableError when metrics-server is missing or not ready. */
  listPodMetrics(namespace: string): Promise<PodUsage[]>;
  listNodes(): Promise<NodeInfo[]>;
  /** Throws MetricsUnavailableError when metrics-server is missing or not ready. */
  listNodeMetrics(): Promise<NodeUsage[]>;

  /** Calls GET /health on the app through its Service and measures how long it takes. */
  getServiceHealth(namespace: string, service: string, port: number, timeoutMs: number): Promise<HealthProbe>;
}

/** What the gateway was doing when a call failed. Used to write the message. */
export interface CallContext {
  /** Finishes the sentence "The assistant is not allowed to ...", for example "update the deployment". */
  action: string;
  namespace?: string;
  /** Name of the kubeconfig context. */
  context: string;
}

/** The parts of a Kubernetes error answer (a "Status" object) that we use. */
export interface KubernetesStatus {
  message?: string;
  details?: { name?: string; kind?: string };
}
