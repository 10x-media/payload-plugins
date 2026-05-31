import type { Payload } from 'payload'

/**
 * Common seed helpers. `withSeed.empty` is the noop default; extend as plugin
 * tests need richer fixtures.
 */
export const withSeed = {
	empty: async (_payload: Payload): Promise<void> => {},
}
