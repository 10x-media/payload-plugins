import { describe, expect, it } from 'vitest'

import {
	dividerBefore,
	initialWindow,
	mergeMessages,
	newestUpdate,
	type WindowMessage,
	type WindowState,
	windowReducer,
} from './window'

const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 10, 0, second)).toISOString()

const message = (
	id: number,
	second: number,
	extra: Partial<WindowMessage> = {}
): WindowMessage => ({
	authorKey: 'users:2',
	channel: 'internal',
	createdAt: at(second),
	id,
	key: 'collection:persons:1',
	type: 'text',
	updatedAt: at(second),
	...extra,
})

const loaded = (messages: WindowMessage[], extra: Partial<WindowState> = {}): WindowState => ({
	...windowReducer(initialWindow, {
		hasNewer: false,
		hasOlder: false,
		messages,
		type: 'loaded',
	}),
	...extra,
})

describe('feed window', () => {
	it('orders by createdAt, ties by id', () => {
		const state = loaded([message(3, 1), message(1, 1), message(2, 0)])
		expect(state.messages.map((m) => m.id)).toEqual([2, 1, 3])
	})

	it('merges an overlapping page by id without duplicates', () => {
		const merged = mergeMessages(
			[message(1, 1), message(2, 2)],
			[message(2, 2, { text: 'edited' }), message(3, 3)]
		)
		expect(merged.map((m) => [m.id, m.text])).toEqual([
			[1, undefined],
			[2, 'edited'],
			[3, undefined],
		])
	})

	it('drops removed rows on change sync', () => {
		const state = windowReducer(loaded([message(1, 1), message(2, 2)]), {
			messages: [message(1, 1, { removed: true })],
			type: 'changes',
		})
		expect(state.messages.map((m) => m.id)).toEqual([2])
	})

	it('does not append polled messages while the window is not at the end', () => {
		const state = windowReducer(loaded([message(1, 1), message(2, 2)], { hasNewer: true }), {
			messages: [message(3, 3), message(1, 1, { text: 'edited' })],
			type: 'changes',
		})
		expect(state.messages.map((m) => m.id)).toEqual([1, 2])
		expect(state.messages[0]?.text).toBe('edited')
	})

	it('prepends older pages and tracks hasOlder', () => {
		const state = windowReducer(loaded([message(3, 3)], { hasOlder: true }), {
			hasOlder: false,
			messages: [message(1, 1), message(2, 2)],
			type: 'older',
		})
		expect(state.messages.map((m) => m.id)).toEqual([1, 2, 3])
		expect(state.hasOlder).toBe(false)
	})

	it('replaces an optimistic send with the confirmed message by clientId', () => {
		const optimistic = message(-1, 5, { clientId: 'c1', sendStatus: 'sending' })
		let state = windowReducer(loaded([message(1, 1)]), { message: optimistic, type: 'optimistic' })
		expect(state.messages).toHaveLength(2)
		state = windowReducer(state, { clientId: 'c1', type: 'failed' })
		expect(state.messages[1]?.sendStatus).toBe('failed')
		state = windowReducer(state, {
			message: message(9, 6, { clientId: 'c1' }),
			type: 'confirmed',
		})
		expect(state.messages.map((m) => m.id)).toEqual([1, 9])
		expect(state.messages[1]?.sendStatus).toBeUndefined()
	})

	it('jumping to latest resets the window', () => {
		const state = windowReducer(loaded([message(1, 1)], { hasNewer: true }), {
			hasNewer: false,
			hasOlder: true,
			messages: [message(8, 8), message(9, 9)],
			type: 'loaded',
		})
		expect(state.messages.map((m) => m.id)).toEqual([8, 9])
		expect(state.hasNewer).toBe(false)
	})

	it('places the divider above the first unread message from someone else', () => {
		const state = loaded(
			[message(1, 1), message(2, 2, { authorKey: 'users:1' }), message(3, 3), message(4, 4)],
			{ cursor: at(1) }
		)
		expect(dividerBefore(state, 'users:1')).toBe('3')
		expect(dividerBefore({ ...state, cursor: null }, 'users:1')).toBeNull()
		expect(dividerBefore({ ...state, cursor: at(9) }, 'users:1')).toBeNull()
	})

	it('only raises the seen cursor', () => {
		let state = windowReducer(initialWindow, { at: at(5), type: 'seen' })
		state = windowReducer(state, { at: at(3), type: 'seen' })
		expect(state.seenAt).toBe(at(5))
		state = windowReducer(state, { at: at(7), type: 'seen' })
		expect(state.seenAt).toBe(at(7))
	})

	it('finds the newest update, ignoring unsent messages', () => {
		expect(
			newestUpdate([
				message(1, 1, { updatedAt: at(9) }),
				message(2, 2),
				message(-1, 20, { sendStatus: 'sending' }),
			])
		).toBe(at(9))
	})
})
