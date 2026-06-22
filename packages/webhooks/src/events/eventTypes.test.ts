import { describe, expect, it } from 'vitest'
import { eventCatalog, eventId, operationToEvent } from './eventTypes'

describe('operationToEvent', () => {
	it('maps present-tense operations to past-tense suffixes', () => {
		expect(operationToEvent('create')).toBe('created')
		expect(operationToEvent('update')).toBe('updated')
		expect(operationToEvent('delete')).toBe('deleted')
	})
})

describe('eventId', () => {
	it('joins slug and event suffix', () => {
		expect(eventId('posts', 'create')).toBe('posts.created')
	})
})

describe('eventCatalog', () => {
	it('expands `true` to all three operations', () => {
		expect(eventCatalog({ posts: true })).toEqual([
			'posts.created',
			'posts.updated',
			'posts.deleted',
		])
	})

	it('honors a restricted operations list', () => {
		expect(eventCatalog({ orders: { operations: ['create', 'delete'] } })).toEqual([
			'orders.created',
			'orders.deleted',
		])
	})
})
