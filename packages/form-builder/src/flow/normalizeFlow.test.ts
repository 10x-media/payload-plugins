import { describe, expect, it } from 'vitest'
import { normalizeFlow } from './normalizeFlow'

const fieldNames = ['name', 'x', 'y', 'email']

describe('normalizeFlow', () => {
	it('returns undefined for an absent/empty flow or a single step', () => {
		expect(normalizeFlow(undefined, fieldNames)).toBeUndefined()
		expect(normalizeFlow({ steps: [] }, fieldNames)).toBeUndefined()
		expect(normalizeFlow({ steps: [{ id: 'a', fields: ['name'] }] }, fieldNames)).toBeUndefined()
	})
	it('keeps a valid multi-step flow, dropping unknown field refs', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name', 'ghost'], next: 'b' },
					{ id: 'b', fields: ['email'] },
				],
			},
			fieldNames
		)
		expect(flow?.steps[0]?.fields).toEqual(['name'])
		expect(flow?.steps).toHaveLength(2)
	})
	it('drops a transition whose target step does not exist', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{
						id: 'a',
						fields: ['name'],
						transitions: [
							{ when: { name: { equals: 'x' } }, to: 'nope' },
							{ when: { name: { equals: 'y' } }, to: 'b' },
						],
						next: 'b',
					},
					{ id: 'b', fields: ['email'] },
				],
			},
			fieldNames
		)
		expect(flow?.steps[0]?.transitions).toEqual([{ when: { name: { equals: 'y' } }, to: 'b' }])
	})
	it('drops a default next that points at an unknown step', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name'], next: 'nope' },
					{ id: 'b', fields: ['email'] },
				],
			},
			fieldNames
		)
		expect(flow?.steps[0]?.next).toBeUndefined()
	})
})
