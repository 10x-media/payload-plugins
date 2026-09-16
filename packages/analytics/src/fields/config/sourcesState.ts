import type { AnalyticsSources } from './useAnalyticsSources'

export interface KeyedSources {
	key: string
	data: AnalyticsSources
}

export const EMPTY_SOURCES: AnalyticsSources = {
	defaultId: null,
	error: false,
	loading: false,
	sources: null,
}

export const LOADING_SOURCES: AnalyticsSources = { ...EMPTY_SOURCES, loading: true }

export const FAILED_SOURCES: AnalyticsSources = { ...EMPTY_SOURCES, error: true }

/**
 * Sources fetched for another user never render: a key mismatch reads as not-yet-loaded,
 * and as still loading whenever there is a user whose fetch has yet to answer.
 */
export const resolveSourcesState = (state: KeyedSources, userKey: string): AnalyticsSources => {
	if (state.key === userKey) return state.data
	return userKey ? LOADING_SOURCES : EMPTY_SOURCES
}
