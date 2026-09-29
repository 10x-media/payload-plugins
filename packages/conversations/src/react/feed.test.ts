import { describe, expect, it } from 'vitest'

import { buildFeedRows } from './feed'
import type { WindowMessage } from './window'

const NOW = new Date('2026-03-10T12:00:00').getTime()

const message = (
	id: string,
	at: string,
	{ author = 'users:1', ...extra }: Partial<WindowMessage> & { author?: string } = {}
) =>
	({
		authorKey: author,
		channel: 'internal',
		createdAt: new Date(at).toISOString(),
		id,
		key: 'k',
		type: 'text',
		updatedAt: at,
		...extra,
	}) as WindowMessage

describe('buildFeedRows', () => {
	it('groups follow-ups, starts days, marks the divider and interleaves items', () => {
		const rows = buildFeedRows({
			dividerBefore: '4',
			items: [{ at: new Date('2026-03-10T10:01:00').toISOString(), id: 'audit', node: null }],
			messages: [
				message('1', '2026-03-09T09:00:00'),
				message('2', '2026-03-10T10:00:00'),
				message('3', '2026-03-10T10:02:00'),
				message('4', '2026-03-10T10:03:00'),
				message('5', '2026-03-10T10:04:00', { author: 'users:2' }),
				message('6', '2026-03-10T10:05:00', { author: 'users:2', sendStatus: 'failed' }),
			],
			now: NOW,
		})
		expect(
			rows.map((row) =>
				row.kind === 'item'
					? `item:${row.day?.relative ?? '-'}`
					: `${row.message.id}:${row.day?.relative ?? (row.day ? 'date' : '-')}:${row.compact ? 'c' : ''}${row.divider ? 'd' : ''}`
			)
		).toEqual([
			'1:yesterday:',
			'2:today:',
			// An item between two messages breaks the group.
			'item:-',
			'3:-:',
			// The divider starts a fresh block even from the same author.
			'4:-:d',
			'5:-:',
		])
	})

	it('never groups a bare row, and starts a fresh group after one', () => {
		const rows = buildFeedRows({
			isBare: (row) => row.type === 'system.note',
			messages: [
				message('1', '2026-03-10T10:00:00'),
				message('2', '2026-03-10T10:01:00', { type: 'system.note' }),
				message('3', '2026-03-10T10:02:00'),
				message('4', '2026-03-10T10:03:00'),
			],
			now: NOW,
		})
		expect(rows.map((row) => (row.kind === 'message' && row.compact ? 'c' : '-'))).toEqual([
			'-',
			'-',
			'-',
			'c',
		])
	})
})
