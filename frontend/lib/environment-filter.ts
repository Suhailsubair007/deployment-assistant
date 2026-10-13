// Which cards of the status panel are shown.

import type { EnvironmentFilter, FilterChoices } from "@/lib/types.ts";

/** Every card is shown. */
export const NO_FILTER: EnvironmentFilter = { app: null, environment: null };

/** The names the two filters offer. Apps are sorted; environments keep the order of the cards. */
export function filterChoices(cards: { environment: string; app: string }[]): FilterChoices {
  return {
    apps: [...new Set(cards.map((card) => card.app))].sort((a, b) => a.localeCompare(b)),
    environments: [...new Set(cards.map((card) => card.environment))],
  };
}

/** The filter without a name that is no longer offered, for example an app that was removed from the cluster. */
export function settleFilter(filter: EnvironmentFilter, choices: FilterChoices): EnvironmentFilter {
  return {
    app: filter.app !== null && choices.apps.includes(filter.app) ? filter.app : null,
    environment:
      filter.environment !== null && choices.environments.includes(filter.environment) ? filter.environment : null,
  };
}

export function isFiltering(filter: EnvironmentFilter): boolean {
  return filter.app !== null || filter.environment !== null;
}

/** The cards that match both filters, in their own order. */
export function filterCards<Card extends { environment: string; app: string }>(
  cards: Card[],
  filter: EnvironmentFilter,
): Card[] {
  return cards.filter(
    (card) =>
      (filter.app === null || card.app === filter.app) &&
      (filter.environment === null || card.environment === filter.environment),
  );
}
