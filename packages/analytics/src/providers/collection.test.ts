import type {
	CollectionAfterChangeHook,
	CollectionAfterDeleteHook,
	Field,
	TextField,
} from 'payload'
import { describe, expect, it } from 'vitest'
import type { BuildProvidersCollectionArgs, BuildSecretField } from './collection'
import { buildProvidersCollection } from './collection'

const named = (fields: Field[] | undefined, name: string): Field | undefined =>
	fields?.find((f) => 'name' in f && f.name === name)

/** Echoes the source field back with a marker so tests can assert delegation. */
const fakeBuildSecret: BuildSecretField = (source) => [{ ...source, custom: { fake: source.type } }]

const unscopedArgs: Pick<
	BuildProvidersCollectionArgs,
	'scoped' | 'scopeField' | 'resolveScope' | 'platformRead' | 'buildSecret'
> = {
	scoped: false,
	scopeField: 'scope',
	resolveScope: async () => null,
	platformRead: async () => false,
	buildSecret: fakeBuildSecret,
}

describe('buildProvidersCollection', () => {
	const collection = buildProvidersCollection({
		slug: 'analytics-providers',
		onChange: () => {},
		...unscopedArgs,
	})

	it('uses the given slug and admin-only access by default', async () => {
		expect(collection.slug).toBe('analytics-providers')
		const read = collection.access?.read
		expect(typeof read).toBe('function')
		expect(await read?.({ req: { user: null } } as never)).toBe(false)
		expect(await read?.({ req: { user: { id: 1 } } } as never)).toBe(true)
	})

	it('has one conditional config group per provider', () => {
		for (const provider of ['plausible', 'umami', 'ga4', 'posthog']) {
			const group = named(collection.fields, provider)
			expect(group?.type).toBe('group')
			const condition = group?.admin?.condition
			expect(condition?.({ provider }, { provider }, {} as never)).toBe(true)
			expect(condition?.({ provider: 'other' }, { provider: 'other' }, {} as never)).toBe(false)
		}
	})

	it('keeps the scope field hidden, indexed text', () => {
		const scope = named(collection.fields, 'scope') as TextField | undefined
		expect(scope?.type).toBe('text')
		expect(scope?.index).toBe(true)
		expect(scope?.admin?.hidden).toBe(true)
	})

	it('delegates secret fields to buildSecret with the right source shape', () => {
		const group = named(collection.fields, 'plausible')
		const fields = group && 'fields' in group ? group.fields : []
		const row = fields[0]
		const apiKey = row && 'fields' in row ? named(row.fields, 'apiKey') : undefined
		expect(apiKey?.type).toBe('text')
		expect((apiKey as { custom?: Record<string, unknown> } | undefined)?.custom).toEqual({
			fake: 'text',
		})

		const ga4Group = named(collection.fields, 'ga4')
		const ga4Fields = ga4Group && 'fields' in ga4Group ? ga4Group.fields : []
		const privateKey = named(ga4Fields, 'privateKey')
		expect(privateKey?.type).toBe('textarea')
		expect((privateKey as { custom?: Record<string, unknown> } | undefined)?.custom).toEqual({
			fake: 'textarea',
		})
	})

	it('invokes onChange from afterChange and afterDelete hooks', async () => {
		let calls = 0
		const withHook = buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {
				calls++
			},
			...unscopedArgs,
		})
		const afterChange = withHook.hooks?.afterChange?.[0] as CollectionAfterChangeHook
		const afterDelete = withHook.hooks?.afterDelete?.[0] as CollectionAfterDeleteHook
		await afterChange({ doc: {} } as never)
		await afterDelete({ doc: {} } as never)
		expect(calls).toBe(2)
	})

	it('merges access overrides over the defaults per operation', async () => {
		const custom = buildProvidersCollection({
			slug: 'analytics-providers',
			access: { read: () => true },
			onChange: () => {},
			...unscopedArgs,
		})
		expect(custom.access?.read?.({ req: { user: null } } as never)).toBe(true)
		expect(await custom.access?.create?.({ req: { user: null } } as never)).toBe(false)
	})

	it('applies overrides last so anything can be reshaped', () => {
		const custom = buildProvidersCollection({
			slug: 'analytics-providers',
			overrides: (c) => ({ ...c, admin: { ...c.admin, hidden: true } }),
			onChange: () => {},
			...unscopedArgs,
		})
		expect(custom.admin?.hidden).toBe(true)
	})
})
