import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import type { ProviderAccessArgs } from '../providers/access'
import { keys } from '../translations/keys'
import { builtInStaticLabel } from '../translations/staticLabel'
import { METRIC_FIELDS, syncCollection } from './collection'

const named = (fields: Field[]) =>
	Object.fromEntries(
		fields.filter((f): f is Extract<Field, { name: string }> => 'name' in f).map((f) => [f.name, f])
	)

const unscopedAccess: ProviderAccessArgs = {
	scoped: false,
	scopeField: 'scope',
	resolveScope: async () => null,
	crossScope: async () => false,
}

const scopedAccess: ProviderAccessArgs = {
	...unscopedAccess,
	scoped: true,
	resolveScope: async () => 't1',
	member: () => true,
}

const requestFrom = (collection: string) =>
	({
		req: {
			user: { id: '1', collection },
			payload: { config: { admin: { user: 'users' } } },
		},
	}) as never

const adminRequest = requestFrom('users')
const customerRequest = requestFrom('customers')

describe('syncCollection', () => {
	it('uses the given slug and a unique (source, date, scope) index', () => {
		const c = syncCollection('analytics-daily', {
			hidden: true,
			access: unscopedAccess,
			read: () => true,
		})
		expect(c.slug).toBe('analytics-daily')
		expect(c.indexes).toEqual([{ fields: ['source', 'date', 'scope'], unique: true }])
	})

	it('has required + indexed source, date and scope, and a number field per metric', () => {
		const byName = named(
			syncCollection('x', { hidden: true, access: unscopedAccess, read: () => true }).fields
		)
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

	it('locks create/update/delete and gates read on a user of the admin collection in unscoped installs', async () => {
		const access = syncCollection('x', {
			hidden: true,
			access: unscopedAccess,
			read: () => true,
		}).access
		expect(access?.create?.({ req: {} } as never)).toBe(false)
		expect(access?.update?.({ req: {} } as never)).toBe(false)
		expect(access?.delete?.({ req: {} } as never)).toBe(false)
		expect(await access?.read?.({ req: {} } as never)).toBe(false)
		expect(await access?.read?.(adminRequest)).toBe(true)
		expect(await access?.read?.(customerRequest)).toBe(false)
	})

	it('constrains reads to the resolved scope in scoped installs', async () => {
		const access = syncCollection('x', {
			hidden: true,
			access: scopedAccess,
			read: () => true,
		}).access
		const result = await access?.read?.(adminRequest)
		expect(result).toEqual({ scope: { equals: 't1' } })
	})

	it('reads nothing in a resolved scope the user does not belong to', async () => {
		const access = syncCollection('x', {
			hidden: true,
			access: { ...scopedAccess, member: () => false },
			read: () => true,
		}).access
		expect(await access?.read?.(adminRequest)).toBe(false)
	})

	it('reads nothing for a user access.read denies, whatever the scope would allow', async () => {
		const access = syncCollection('x', {
			hidden: true,
			access: scopedAccess,
			read: ({ req }) => req.user?.id === 'boss',
		}).access
		expect(await access?.read?.(adminRequest)).toBe(false)
		const unscoped = syncCollection('x', {
			hidden: true,
			access: unscopedAccess,
			read: async () => false,
		}).access
		expect(await unscoped?.read?.(adminRequest)).toBe(false)
	})

	it('sits in the settings group, apart from the Analytics view link of the same name', () => {
		const c = syncCollection('x', { hidden: false, access: unscopedAccess, read: () => true })
		expect(c.admin?.group).toEqual(builtInStaticLabel(keys.adminGroup))
		expect(builtInStaticLabel(keys.adminGroup)).not.toEqual(builtInStaticLabel(keys.viewNavLabel))
	})

	it('is hidden from the admin nav by default, and surfaces when asked', () => {
		expect(
			syncCollection('x', { hidden: true, access: unscopedAccess, read: () => true }).admin?.hidden
		).toBe(true)
		expect(
			syncCollection('x', { hidden: false, access: unscopedAccess, read: () => true }).admin?.hidden
		).toBe(false)
	})
})
