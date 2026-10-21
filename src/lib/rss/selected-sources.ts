import { feedInventory } from "./sources.ts";
import { createFeedCatalog } from "./discovery.ts";
import { createFeedHandlers } from "./selective-api.ts";

export const discoveryCatalog = createFeedCatalog(feedInventory);
export const feedHandlers = createFeedHandlers(discoveryCatalog);
