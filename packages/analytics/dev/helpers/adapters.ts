import { memoryAdapter } from '../../src/testing/memoryAdapter'

/**
 * A second (in-memory) provider for the dev app, shared between the plugin config and
 * the seeder so seeded events land in the instance the registry queries. Running two
 * adapters keeps the multi-provider surfaces testable in dev: the widget data-source
 * select, per-source metric narrowing, and the sync tier (which persists external
 * providers only, so a native-only config would never produce analytics-daily rows).
 */
export const devMemoryAdapter = memoryAdapter()
