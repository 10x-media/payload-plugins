import { describe, expect, it } from 'vitest'
import { EMPTY_SOURCES, resolveSourcesState } from './sourcesState'

describe('resolveSourcesState', () => {
	const data = { defaultId: 'memory', sources: [] }

	it('returns the data when it belongs to the current user', () => {
		expect(resolveSourcesState({ key: 'u1', data }, 'u1')).toBe(data)
	})

	it("returns empty while another user's fetch is pending (user switch)", () => {
		expect(resolveSourcesState({ key: 'u1', data }, 'u2')).toBe(EMPTY_SOURCES)
	})

	it('returns empty for the signed-out key', () => {
		expect(resolveSourcesState({ key: 'u1', data }, '')).toBe(EMPTY_SOURCES)
	})
})
