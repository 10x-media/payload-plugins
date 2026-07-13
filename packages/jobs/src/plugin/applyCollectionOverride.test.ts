import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { describe, expect, it } from 'vitest'
import { applyCollectionOverride } from './applyCollectionOverride'

const base: CollectionConfig = {
	slug: 'payload-jobs',
	admin: { group: 'System', useAsTitle: 'jobTitle' },
	fields: [{ name: 'queue', type: 'text' }],
	hooks: { beforeChange: [(() => undefined) as CollectionBeforeChangeHook] },
}

describe('applyCollectionOverride', () => {
	it('returns the collection untouched without an override', () => {
		expect(applyCollectionOverride(base, undefined)).toBe(base)
	})

	it('merges admin keys and locks the slug', () => {
		const result = applyCollectionOverride(base, { admin: { group: 'Ops' }, slug: 'nope' } as never)
		expect(result.slug).toBe('payload-jobs')
		expect(result.admin?.group).toBe('Ops')
		expect(result.admin?.useAsTitle).toBe('jobTitle')
	})

	it('appends consumer hooks after plugin hooks and applies the fields function', () => {
		const consumerHook = (() => undefined) as CollectionBeforeChangeHook
		const result = applyCollectionOverride(base, {
			fields: ({ defaultFields }) => [...defaultFields, { name: 'extra', type: 'text' }],
			hooks: { beforeChange: [consumerHook] },
		})
		expect(result.hooks?.beforeChange).toHaveLength(2)
		expect(result.hooks?.beforeChange?.[1]).toBe(consumerHook)
		expect(result.fields).toHaveLength(2)
	})
})
