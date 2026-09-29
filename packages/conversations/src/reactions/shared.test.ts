import { describe, expect, it } from 'vitest'

import { NAMES_PER_EMOJI, type ReactionRow, summarize } from './shared'

const row = (message: string, userKey: string, [emoji, at]: [string, string]): ReactionRow => ({
	createdAt: `2026-09-25T10:00:${at}.000Z`,
	emoji,
	message,
	userKey,
})

const names = { 'users:1': { name: 'Anna' }, 'users:2': { name: 'Marc' } }

describe('reaction summaries', () => {
	it('groups by message and emoji in order of first use', () => {
		const out = summarize(
			[
				row('m1', 'users:2', ['🎉', '03']),
				row('m1', 'users:1', ['👍', '01']),
				row('m1', 'users:2', ['👍', '02']),
				row('m2', 'users:1', ['👀', '04']),
			],
			'users:1',
			names
		)
		expect(out.m1).toEqual([
			{
				count: 2,
				emoji: '👍',
				mine: true,
				users: [
					{ name: 'Anna', userKey: 'users:1' },
					{ name: 'Marc', userKey: 'users:2' },
				],
			},
			{ count: 1, emoji: '🎉', mine: false, users: [{ name: 'Marc', userKey: 'users:2' }] },
		])
		expect(out.m2?.[0]?.mine).toBe(true)
	})

	it('caps the names but keeps counting', () => {
		const rows = Array.from({ length: NAMES_PER_EMOJI + 5 }, (_, index) =>
			row('m1', `users:${index + 10}`, ['👍', String(index).padStart(2, '0')])
		)
		const [entry] = summarize(rows, 'users:1', {}).m1 ?? []
		expect(entry?.count).toBe(NAMES_PER_EMOJI + 5)
		expect(entry?.users).toHaveLength(NAMES_PER_EMOJI)
		expect(entry?.mine).toBe(false)
	})
})
