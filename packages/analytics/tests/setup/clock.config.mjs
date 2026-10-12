// biome-ignore-all lint/plugin/noProcessEnv: vitest config env boundary
import config from '../../vitest.config.ts'

/**
 * Package config at 00:05 UTC on the US daylight saving exit in Adak (previous date, 25-hour day),
 * so a test leaning on real clock or zone fails every run. Plain JS keeps typecheck out of it.
 */
process.env.TZ = 'America/Adak'
process.env.ANALYTICS_TEST_NOW = '2026-11-02T00:05:00.000Z'

export default config
