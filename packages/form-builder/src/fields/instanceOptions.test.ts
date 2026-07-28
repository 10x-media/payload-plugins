import { describe, expect, it } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { instanceOptionsOf } from './instanceOptions'

describe('instanceOptionsOf', () => {
	it('maps authored options to value/label pairs', () => {
		const field: FormFieldInstance = {
			blockType: 'select',
			name: 'plan',
			options: [
				{ label: 'Free', value: 'free' },
				{ label: 'Pro', value: 'pro' },
			],
		}
		expect(instanceOptionsOf(field)).toEqual([
			{ value: 'free', label: 'Free' },
			{ value: 'pro', label: 'Pro' },
		])
	})

	it('falls back to the value as label when no label was authored', () => {
		const field: FormFieldInstance = {
			blockType: 'select',
			name: 'plan',
			options: [{ value: 'a' }],
		}
		expect(instanceOptionsOf(field)).toEqual([{ value: 'a', label: 'a' }])
	})

	it('falls back to the value as label when the authored label is blank', () => {
		const field: FormFieldInstance = {
			blockType: 'select',
			name: 'plan',
			options: [{ label: '', value: 'b' }],
		}
		expect(instanceOptionsOf(field)).toEqual([{ value: 'b', label: 'b' }])
	})

	it('drops entries without a string value', () => {
		const field: FormFieldInstance = {
			blockType: 'select',
			name: 'plan',
			options: [{ label: 'Free' }, { label: 'Pro', value: 'pro' }],
		}
		expect(instanceOptionsOf(field)).toEqual([{ value: 'pro', label: 'Pro' }])
	})

	it('returns undefined for a non-array or empty options declaration', () => {
		expect(instanceOptionsOf({ blockType: 'text', name: 't' })).toBeUndefined()
		expect(instanceOptionsOf({ blockType: 'select', name: 's', options: [] })).toBeUndefined()
	})
})
