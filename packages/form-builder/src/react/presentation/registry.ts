import { defaultPresentations } from './presentations'
import type { FormPresentation } from './types'

export type PresentationRegistry = Map<string, FormPresentation>

/** `false` removes, `true` keeps the default, a presentation adds or replaces one. */
export type PresentationOption = boolean | FormPresentation

export type PresentationsConfig = Record<string, PresentationOption>

export const resolvePresentations = (
	defaults: Record<string, FormPresentation> = defaultPresentations,
	config: PresentationsConfig = {}
): PresentationRegistry => {
	const registry: PresentationRegistry = new Map(Object.entries(defaults))
	for (const [name, option] of Object.entries(config)) {
		if (option === false) {
			registry.delete(name)
		} else if (option === true) {
			// keep the default
		} else {
			registry.set(name, option)
		}
	}
	return registry
}
