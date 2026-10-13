import type { ServiceRegistry } from "@/services/serviceRegistry.ts";
import type { KnownNames } from "@/types/agent.ts";
import type { AppConfig } from "@/types/config.ts";

/**
 * The names the chat understands. The apps are read from the registry every time they
 * are used, so a service created a moment ago is known at once, without a restart.
 */
export function liveNames(config: AppConfig, registry: ServiceRegistry): KnownNames {
  return {
    environments: Object.keys(config.environments),
    get apps(): string[] {
      return registry.names();
    },
  };
}
