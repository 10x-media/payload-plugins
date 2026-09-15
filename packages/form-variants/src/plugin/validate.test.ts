import type { CollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import type { FormVariantsConfig } from '../types'
import { validateCollectionConfig } from './validate'

const people: CollectionConfig = {
	slug: 'people',
	fields: [
		{ name: 'firstName', type: 'text' },
		{
			type: 'row',
			fields: [{ name: 'lastName', type: 'text' }],
		},
		{
			name: 'address',
			type: 'group',
			fields: [{ name: 'city', type: 'text' }],
		},
		{
			name: 'skills',
			type: 'array',
			fields: [{ name: 'name', type: 'text' }],
		},
	],
}

const quick = (overrides: Partial<FormVariantsConfig> = {}): FormVariantsConfig => ({
	variants: [
		{
			key: 'quick',
			steps: [{ key: 'identity', fields: ['firstName', 'lastName', 'address.city', 'skills'] }],
		},
	],
	...overrides,
})

describe('validateCollectionConfig', () => {
	it('accepts data paths through unnamed rows, named groups and whole arrays', () => {
		expect(() => validateCollectionConfig(people, quick())).not.toThrow()
	})

	it('refuses a collection whose edit.default is already overridden', () => {
		const overridden: CollectionConfig = {
			...people,
			admin: { components: { views: { edit: { default: { Component: './X#X' } } } } },
		}
		expect(() => validateCollectionConfig(overridden, quick())).toThrow(/edit\.default/)
	})

	it('refuses a collection whose edit.root is overridden', () => {
		const overridden: CollectionConfig = {
			...people,
			admin: { components: { views: { edit: { root: { Component: './X#X' } } } } },
		}
		expect(() => validateCollectionConfig(overridden, quick())).toThrow(/edit\.root/)
	})

	it('names an unknown field path', () => {
		const config = quick({ variants: [{ key: 'q', steps: [{ key: 's', fields: ['nope'] }] }] })
		expect(() => validateCollectionConfig(people, config)).toThrow(/unknown field path "nope"/)
	})

	it('explains a path below an array', () => {
		const config = quick({
			variants: [{ key: 'q', steps: [{ key: 's', fields: ['skills.0.name'] }] }],
		})
		expect(() => validateCollectionConfig(people, config)).toThrow(/"skills" is an array/)
	})

	it('refuses a step with both fields and a Component', () => {
		const config = quick({
			variants: [
				{
					key: 'q',
					steps: [{ key: 's', Component: './X#X', fields: ['firstName'] } as never],
				},
			],
		})
		expect(() => validateCollectionConfig(people, config)).toThrow(/not both/)
	})

	it('refuses duplicate variant and step keys', () => {
		expect(() =>
			validateCollectionConfig(
				people,
				quick({
					variants: [
						{ key: 'q', steps: [{ key: 's', fields: ['firstName'] }] },
						{ key: 'q', steps: [{ key: 's', fields: ['firstName'] }] },
					],
				})
			)
		).toThrow(/variant key "q" twice/)
		expect(() =>
			validateCollectionConfig(
				people,
				quick({
					variants: [
						{
							key: 'q',
							steps: [
								{ key: 's', fields: ['firstName'] },
								{ key: 's', fields: ['lastName'] },
							],
						},
					],
				})
			)
		).toThrow(/step key "s" twice/)
	})

	it('lets native carry only key, label and access', () => {
		expect(() =>
			validateCollectionConfig(
				people,
				quick({
					variants: [
						{ key: 'q', steps: [{ key: 's', fields: ['firstName'] }] },
						{ key: 'native', save: 'always' } as never,
					],
				})
			)
		).toThrow(/native/)
	})

	it('refuses a config defined for another collection', () => {
		expect(() => validateCollectionConfig(people, quick({ slug: 'companies' }))).toThrow(
			/defined for "companies"/
		)
		expect(() => validateCollectionConfig(people, quick({ slug: 'people' }))).not.toThrow()
	})

	it('checks a string defaultVariant against the listed keys', () => {
		expect(() =>
			validateCollectionConfig(people, quick({ defaultVariant: 'native' }))
		).not.toThrow()
		expect(() => validateCollectionConfig(people, quick({ defaultVariant: 'ghost' }))).toThrow(
			/defaultVariant "ghost"/
		)
	})
})
