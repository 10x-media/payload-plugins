import { describe, expect, it } from 'vitest'
import { EMPTY_SOURCES, LOADING_SOURCES, resolveSourcesState } from './sourcesState'

describe('resolveSourcesState', () => {
	const data = { defaultId: 'memory', error: false, loading: false, sources: [] }

	it('returns the data when it belongs to the current user', () => {
		expect(resolveSourcesState({ key: 'u1', data }, 'u1')).toBe(data)
	})

	it("reads as loading while another user's fetch is pending (user switch)", () => {
		expect(resolveSourcesState({ key: 'u1', data }, 'u2')).toBe(LOADING_SOURCES)
	})

	it('returns empty, not loading, for the signed-out key', () => {
		expect(resolveSourcesState({ key: 'u1', data }, '')).toBe(EMPTY_SOURCES)
	})

	it('reads as loading before the first fetch answers', () => {
		expect(resolveSourcesState({ key: '', data: EMPTY_SOURCES }, 'u1').loading).toBe(true)
	})
})
