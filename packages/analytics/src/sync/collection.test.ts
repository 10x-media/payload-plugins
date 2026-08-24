import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import type { ProviderAccessArgs } from '../providers/access'
import { METRIC_FIELDS, syncCollection } from './collection'

const named = (fields: Field[]) =>
	Object.fromEntries(
		fields.filter((f): f is Extract<Field, { name: string }> => 'name' in f).map((f) => [f.name, f])
	)

const unscopedAccess: ProviderAccessArgs = {
	scoped: false,
	scopeField: 'scope',
	resolveScope: async () => null,
	platformRead: async () => false,
}

const scopedAccess: ProviderAccessArgs = {
	...unscopedAccess,
	scoped: true,
	resolveScope: async () => 't1',
}

describe('syncCollection', () => {
	it('uses the given slug and a unique (source, date, scope) index', () => {
		const c = syncCollection('analytics-daily', true, unscopedAccess)
		expect(c.slug).toBe('analytics-daily')
		expect(c.indexes).toEqual([{ fields: ['source', 'date', 'scope'], unique: true }])
	})

	it('has required + indexed source, date and scope, and a number field per metric', () => {
		const byName = named(syncCollection('x', true, unscopedAccess).fields)
		expect(byName.source).toMatchObject({ type: 'text', required: true, index: true })
		expect(byName.date).toMatchObject({ type: 'date', required: true, index: true })
		expect(byName.scope).toMatchObject({
			type: 'text',
			required: true,
			defaultValue: '',
			index: true,
		})
		for (const metric of METRIC_FIELDS) {
			expect(byName[metric]).toMatchObject({ type: 'number' })
		}
		expect(byName.syncedAt).toMatchObject({ type: 'date' })
	})

	it('locks create/update/delete and gates read on an authenticated user in unscoped installs', async () => {
		const access = syncCollection('x', true, unscopedAccess).access
		expect(access?.create?.({ req: {} } as never)).toBe(false)
		expect(access?.update?.({ req: {} } as never)).toBe(false)
		expect(access?.delete?.({ req: {} } as never)).toBe(false)
		expect(await access?.read?.({ req: {} } as never)).toBe(false)
		expect(await access?.read?.({ req: { user: { id: '1' } } } as never)).toBe(true)
	})

	it('constrains reads to the resolved scope in scoped installs', async () => {
		const access = syncCollection('x', true, scopedAccess).access
		const result = await access?.read?.({ req: { user: { id: '1' } } } as never)
		expect(result).toEqual({ scope: { equals: 't1' } })
	})

	it('is hidden from the admin nav by default, and surfaces when asked', () => {
		expect(syncCollection('x', true, unscopedAccess).admin?.hidden).toBe(true)
		expect(syncCollection('x', false, unscopedAccess).admin?.hidden).toBe(false)
	})
})
