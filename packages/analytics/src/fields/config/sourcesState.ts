import type { AnalyticsSources } from './useAnalyticsSources'

export interface KeyedSources {
	key: string
	data: AnalyticsSources
}

export const EMPTY_SOURCES: AnalyticsSources = { defaultId: null, sources: null }

/** Sources fetched for another user never render: a key mismatch reads as not-yet-loaded. */
export const resolveSourcesState = (state: KeyedSources, userKey: string): AnalyticsSources =>
	state.key === userKey ? state.data : EMPTY_SOURCES
