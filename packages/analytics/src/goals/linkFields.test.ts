import type { NumberField, TextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { GOAL_FIELD_COMPONENT } from './goalField'
import { analyticsLinkFields } from './linkFields'

describe('analyticsLinkFields', () => {
	it('returns the goal picker alone by default', () => {
		const fields = analyticsLinkFields()
		expect(fields).toHaveLength(1)
		const goal = fields[0] as TextField
		expect(goal.name).toBe('goal')
		expect(goal.admin?.components?.Field).toEqual({ path: GOAL_FIELD_COMPONENT })
	})

	it('passes its goal options straight through', () => {
		const [goal] = analyticsLinkFields({ goal: { name: 'analyticsGoal', required: true } })
		expect((goal as TextField).name).toBe('analyticsGoal')
		expect((goal as TextField).required).toBe(true)
	})

	it('adds a per-link value field on request, shown only once a goal is picked', () => {
		const fields = analyticsLinkFields({ value: true })
		expect(fields).toHaveLength(2)
		const value = fields[1] as NumberField
		expect(value.name).toBe('goalValue')
		expect(value.min).toBe(0)
		expect(value.admin?.condition?.({}, {}, {} as never)).toBe(false)
		expect(value.admin?.condition?.({}, { goal: 'purchase' }, {} as never)).toBe(true)
	})

	it('conditions the value on whatever the goal field was renamed to', () => {
		const [, value] = analyticsLinkFields({ goal: { name: 'cta' }, value: true })
		expect(value?.admin?.condition?.({}, { cta: 'purchase' }, {} as never)).toBe(true)
		expect(value?.admin?.condition?.({}, { goal: 'purchase' }, {} as never)).toBe(false)
	})

	it('gives the overrides the last word on the set', () => {
		const fields = analyticsLinkFields({
			value: { overrides: ({ field }) => ({ ...field, name: 'worth' }) },
			overrides: ({ fields }) => fields.slice().reverse(),
		})
		expect((fields[0] as NumberField).name).toBe('worth')
		expect((fields[1] as TextField).name).toBe('goal')
	})
})
