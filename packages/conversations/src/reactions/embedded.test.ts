import { describe, expect, it } from 'vitest'

import { applyReaction, readStored, type StoredReaction } from './embedded'

const base = { maxPerUser: null, onLimit: 'reject' as const, userKey: 'users:1' }
const at = (n: number) => `2026-01-01T00:00:0${n}.000Z`

describe('applyReaction', () => {
	it('adds once, removes once, and treats repeats as no-ops', () => {
		const added = applyReaction([], { ...base, at: at(1), emoji: '👍', operation: 'add' })
		expect(added).toEqual({
			added: '👍',
			next: [{ at: at(1), emoji: '👍', userKey: 'users:1' }],
			removed: [],
		})
		if (added === 'limit') throw new Error('unexpected')
		expect(
			applyReaction(added.next, { ...base, at: at(2), emoji: '👍', operation: 'add' })
		).toEqual({ added: null, next: added.next, removed: [] })
		expect(
			applyReaction(added.next, { ...base, at: at(2), emoji: '👍', operation: 'remove' })
		).toEqual({ added: null, next: [], removed: ['👍'] })
		expect(applyReaction([], { ...base, at: at(2), emoji: '👍', operation: 'remove' })).toEqual({
			added: null,
			next: [],
			removed: [],
		})
	})

	it('refuses past the limit, or replaces the oldest own reactions', () => {
		const current: StoredReaction[] = [
			{ at: at(2), emoji: '🎉', userKey: 'users:1' },
			{ at: at(1), emoji: '👍', userKey: 'users:1' },
			{ at: at(1), emoji: '👍', userKey: 'users:2' },
		]
		const args = { ...base, at: at(3), emoji: '👀', maxPerUser: 2, operation: 'add' as const }
		expect(applyReaction(current, args)).toBe('limit')
		expect(applyReaction(current, { ...args, onLimit: 'replace' })).toEqual({
			added: '👀',
			next: [
				{ at: at(2), emoji: '🎉', userKey: 'users:1' },
				{ at: at(1), emoji: '👍', userKey: 'users:2' },
				{ at: at(3), emoji: '👀', userKey: 'users:1' },
			],
			removed: ['👍'],
		})
	})
})

describe('readStored', () => {
	it('keeps only well-formed entries', () => {
		expect(readStored(null)).toEqual([])
		expect(readStored([{ at: at(1), emoji: '👍', userKey: 'u' }, { emoji: 1 }, 'x'])).toEqual([
			{ at: at(1), emoji: '👍', userKey: 'u' },
		])
	})
})
