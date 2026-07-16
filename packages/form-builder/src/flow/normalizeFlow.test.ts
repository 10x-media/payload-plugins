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
	it('accepts bare block row ids as field keys alongside names', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name', 'row-note'], next: 'b' },
					{ id: 'b', fields: ['email'] },
				],
			},
			['name', 'row-note', 'email']
		)
		expect(flow?.steps[0]?.fields).toEqual(['name', 'row-note'])
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
	it('keeps only the first occurrence of a field assigned to two steps', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name', 'email'], next: 'b' },
					{ id: 'b', fields: ['email', 'x'] },
				],
			},
			fieldNames
		)
		expect(flow?.steps[0]?.fields).toEqual(['name', 'email'])
		expect(flow?.steps[1]?.fields).toEqual(['x'])
	})
	it('keeps only the first occurrence of a field assigned to three steps', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name'], next: 'b' },
					{ id: 'b', fields: ['name', 'x'], next: 'c' },
					{ id: 'c', fields: ['name'] },
				],
			},
			fieldNames
		)
		expect(flow?.steps.map((s) => s.fields)).toEqual([['name'], ['x'], []])
	})
	it('leaves steps without duplicate fields unchanged', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name', 'x'], next: 'b' },
					{ id: 'b', fields: ['email', 'y'] },
				],
			},
			fieldNames
		)
		expect(flow?.steps.map((s) => s.fields)).toEqual([
			['name', 'x'],
			['email', 'y'],
		])
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
