import type { LabelFunction, TextField, TextFieldSingleValidation } from 'payload'
import { describe, expect, it } from 'vitest'
import { keys } from '../translations/keys'
import { GOAL_FIELD_COMPONENT, goalField, goalSlug } from './goalField'

const componentPath = (field: TextField): string => {
	const component = field.admin?.components?.Field
	if (!component || typeof component !== 'object') throw new Error('expected a component object')
	return (component as { path: string }).path
}

const resolveLabel = (field: TextField): string => {
	const label = field.label as LabelFunction
	return label({ i18n: {} as never, t: ((key: string) => key) as never })
}

const validateWith = (
	field: TextField,
	value: string | null
): Promise<string | true> | string | true => {
	const validate = field.validate as TextFieldSingleValidation
	const options = {
		req: { t: (key: string) => key },
	} as unknown as Parameters<TextFieldSingleValidation>[1]
	return validate(value, options)
}

describe('goalField', () => {
	it('builds a text field rendered by the client goal picker', () => {
		const field = goalField()

		expect(field.type).toBe('text')
		expect(field.name).toBe('goal')
		expect(componentPath(field)).toBe('@10x-media/analytics/client#GoalSelectField')
		expect(GOAL_FIELD_COMPONENT).toBe('@10x-media/analytics/client#GoalSelectField')
	})

	it('defaults the label to the translated goal key', () => {
		expect(resolveLabel(goalField())).toBe(keys.fieldGoalLabel)
	})

	it('honors a custom name, label and required flag', () => {
		const field = goalField({ name: 'primaryGoal', label: 'Primary goal', required: true })

		expect(field.name).toBe('primaryGoal')
		expect(field.label).toBe('Primary goal')
		expect(field.required).toBe(true)
	})

	it('is not required by default', () => {
		expect(goalField().required).toBeUndefined()
	})

	it('merges admin options and keeps its own Field component', () => {
		const field = goalField({
			admin: {
				description: 'Pick one',
				position: 'sidebar',
				components: { Label: { path: './Custom#Label' } },
			},
		})

		expect(field.admin?.description).toBe('Pick one')
		expect(field.admin?.position).toBe('sidebar')
		expect(field.admin?.components?.Label).toEqual({ path: './Custom#Label' })
		expect(componentPath(field)).toBe('@10x-media/analytics/client#GoalSelectField')
	})

	it('applies a function override last', () => {
		const field = goalField({
			name: 'goal',
			overrides: ({ field: base }) => ({ ...base, name: 'renamed', index: true }),
		})

		expect(field.name).toBe('renamed')
		expect(field.index).toBe(true)
	})

	describe('validate', () => {
		it('accepts a kebab slug', () => {
			expect(validateWith(goalField(), 'book-demo')).toBe(true)
		})

		it('rejects a slug that is not kebab-case', () => {
			expect(validateWith(goalField(), 'Book Demo')).toBe(keys.fieldGoalInvalid)
		})

		it('accepts an empty value when the field is optional', () => {
			expect(validateWith(goalField(), null)).toBe(true)
			expect(validateWith(goalField(), '')).toBe(true)
		})

		it('rejects an empty value when the field is required', () => {
			expect(validateWith(goalField({ required: true }), null)).toBe('validation:required')
			expect(validateWith(goalField({ required: true }), '')).toBe('validation:required')
		})

		it('accepts a kebab slug when the field is required', () => {
			expect(validateWith(goalField({ required: true }), 'book-demo')).toBe(true)
		})
	})
})

describe('goalSlug', () => {
	it('passes a plain slug through', () => {
		expect(goalSlug('book-demo')).toBe('book-demo')
	})

	it('trims surrounding whitespace', () => {
		expect(goalSlug(' book-demo ')).toBe('book-demo')
	})

	it('reads the slug out of an object-shaped value', () => {
		expect(goalSlug({ slug: 'signup' })).toBe('signup')
	})

	it('returns null for anything else', () => {
		expect(goalSlug(null)).toBeNull()
		expect(goalSlug(undefined)).toBeNull()
		expect(goalSlug('')).toBeNull()
		expect(goalSlug('   ')).toBeNull()
		expect(goalSlug(42)).toBeNull()
		expect(goalSlug(['book-demo'])).toBeNull()
		expect(goalSlug({ goal: 'signup' })).toBeNull()
		expect(goalSlug({ slug: 7 })).toBeNull()
	})
})
