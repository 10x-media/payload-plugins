import type { RenderedSlots } from './types'

/**
 * The first level that sets `slot`, most specific first (step, variant, collection, plugin).
 * A level that sets it to `false` wins like any other and hides the part; `undefined` means
 * no level set it and the caller renders the built-in.
 */
export const resolveSlot = <K extends keyof RenderedSlots>(
	slot: K,
	levels: (RenderedSlots | undefined)[]
): RenderedSlots[K] => {
	for (const level of levels) {
		if (level?.[slot] !== undefined) {
			return level[slot]
		}
	}
	return undefined
}
