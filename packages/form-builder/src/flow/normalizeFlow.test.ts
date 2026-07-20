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
	it('keeps a step whose fields were all deleted from the form', () => {
		// Dropping it would strand the next/transition targets pointing at it, and a host can render
		// its own content for a step off useFormStep(). The author sees the empty step in the builder.
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name'], next: 'b' },
					{ id: 'b', fields: ['deletedField'] },
					{ id: 'c', fields: ['email'] },
				],
			},
			fieldNames
		)
		expect(flow?.steps).toHaveLength(3)
		expect(flow?.steps[1]).toEqual({ id: 'b', fields: [] })
		expect(flow?.steps[0]?.next).toBe('b')
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
		expect(flow?.steps[0] ? 'next' in flow.steps[0] : undefined).toBe(false)
	})
	it('preserves next: null as distinct from an absent next', () => {
		const flow = normalizeFlow(
			{
				steps: [
					{ id: 'a', fields: ['name'], next: null },
					{ id: 'b', fields: ['x'] },
					{ id: 'c', fields: ['email'], next: 'a' },
				],
			},
			fieldNames
		)
		expect(flow?.steps[0]?.next).toBeNull()
		expect(flow?.steps[1] ? 'next' in flow.steps[1] : undefined).toBe(false)
		expect(flow?.steps[2]?.next).toBe('a')
	})
})
