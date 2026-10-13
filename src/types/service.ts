import type { AppConfig, ResourceAmounts } from "@/types/config.ts";

/** One setting handed to the app when it starts, for example NODE_ENV=production. */
export interface EnvVar {
  name: string;
  value: string;
}

/** Everything the assistant needs to run one service in one environment. */
export interface ServiceSpec {
  /** Used for the Deployment, the Service and the "app" label. */
  name: string;
  environment: string;
  /** Image name without registry or version, for example "orders-api". */
  imageRepository: string;
  /** The project folder the image is built from. Null when the images are built somewhere else. */
  folder: string | null;
  /** Port the app listens on inside the container. */
  port: number;
  /** The path that answers 200 when the app is ready, for example "/health". */
  healthPath: string;
  /** Replicas used the first time the service is deployed. */
  replicas: number;
  /** The assistant refuses to scale beyond this. */
  maxReplicas: number;
  resources: { requests: ResourceAmounts; limits: ResourceAmounts };
  env: EnvVar[];
  /** The number of the newest image built from the folder: 2 means "v2". 0 when none was built. */
  lastVersion: number;
}

export interface ResolvedService {
  /** The Kubernetes namespace of the environment. */
  namespace: string;
  spec: ServiceSpec;
}

export interface ServiceRegistryDeps {
  /** File to store the services in, or ":memory:" for a registry that is not saved. */
  path: string;
  /** Name of the cluster the app is connected to. The file may hold other clusters' services too. */
  cluster: string;
  /** The apps in the config file are services too, in every environment. */
  config: AppConfig;
}
