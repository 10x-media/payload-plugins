import type { AnalyticsAdapter } from './contract'

export interface AdapterRegistry {
	get(id: string): AnalyticsAdapter
	default(): AnalyticsAdapter
	all(): AnalyticsAdapter[]
	isMultiProvider(): boolean
}

export function createRegistry(adapters: AnalyticsAdapter[], defaultId?: string): AdapterRegistry {
	if (adapters.length === 0) throw new Error('analytics: at least one adapter is required')
	const first = adapters[0] as AnalyticsAdapter
	const byId = new Map(adapters.map((a) => [a.id, a]))
	const fallback = defaultId ?? first.id
	return {
		get(id) {
			const a = byId.get(id)
			if (!a) throw new Error(`analytics: unknown adapter "${id}"`)
			return a
		},
		default: () => byId.get(fallback) ?? first,
		all: () => adapters,
		isMultiProvider: () => adapters.length > 1,
	}
}
