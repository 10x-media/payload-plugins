import type {
	CheckboxField,
	CollectionConfig,
	Field,
	NumberField,
	SelectField,
	TextField,
	Where,
} from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { BuildGoalsCollectionArgs } from './collection'
import { buildGoalsCollection, GOALS_SLUG } from './collection'

const named = (fields: Field[] | undefined, name: string): Field | undefined =>
	fields?.find((f) => 'name' in f && f.name === name)

/** Finds a field by name at any depth, walking rows and groups. */
const deep = (fields: Field[] | undefined, name: string): Field | undefined => {
	for (const field of fields ?? []) {
		if ('name' in field && field.name === name) return field
		if ('fields' in field) {
			const hit = deep(field.fields, name)
			if (hit) return hit
		}
	}
	return undefined
}

const groupFields = (fields: Field[] | undefined, name: string): Field[] => {
	const group = named(fields, name)
	return group && 'fields' in group ? group.fields : []
}

/** A request double carrying only what the collection's hooks and validators read. */
const fakeReq = (find?: (args: { where: Where; pagination?: boolean }) => unknown) =>
	({ t: (key: string) => key, payload: { find } }) as never

const unscopedArgs: Omit<BuildGoalsCollectionArgs, 'slug' | 'onChange'> = {
	scoped: false,
	scopeField: 'scope',
	resolveScope: async () => null,
	platformRead: async () => false,
}

const build = (overrides: Partial<BuildGoalsCollectionArgs> = {}) =>
	buildGoalsCollection({ slug: GOALS_SLUG, onChange: () => {}, ...unscopedArgs, ...overrides })

describe('buildGoalsCollection', () => {
	const collection = build()

	it('uses the given slug and admin-only access by default', async () => {
		expect(collection.slug).toBe('analytics-goals')
		const read = collection.access?.read
		expect(await read?.({ req: { user: null } } as never)).toBe(false)
		expect(await read?.({ req: { user: { id: 1 } } } as never)).toBe(true)
	})

	it('lists goals by name', () => {
		expect(collection.admin?.useAsTitle).toBe('name')
		expect(collection.admin?.defaultColumns).toEqual(['name', 'slug', 'match.kind', 'enabled'])
		expect(collection.admin?.group).toBe('Analytics')
	})

	it('rejects a slug that is not kebab-case and accepts one that is', () => {
		const slug = deep(collection.fields, 'slug') as TextField
		const validate = slug.validate as (v: unknown, o: unknown) => true | string
		expect(validate('Book Demo', { req: fakeReq() })).toBe('analytics:goalErrorSlug')
		expect(validate('', { req: fakeReq() })).toBe('analytics:goalErrorSlug')
		expect(validate('book-demo', { req: fakeReq() })).toBe(true)
	})

	it('defaults a goal to enabled', () => {
		const enabled = deep(collection.fields, 'enabled') as CheckboxField
		expect(enabled.defaultValue).toBe(true)
	})

	it('shows the event name only for event matches and the pattern only for path matches', () => {
		const match = groupFields(collection.fields, 'match')
		const kind = named(match, 'kind') as SelectField
		expect(kind.defaultValue).toBe('goal')
		expect(kind.options.map((o) => (typeof o === 'string' ? o : o.value))).toEqual([
			'goal',
			'event',
			'path',
		])
		const eventName = named(match, 'name')
		const pattern = named(match, 'pattern')
		expect(eventName?.admin?.condition?.({}, { kind: 'event' }, {} as never)).toBe(true)
		expect(eventName?.admin?.condition?.({}, { kind: 'path' }, {} as never)).toBe(false)
		expect(pattern?.admin?.condition?.({}, { kind: 'path' }, {} as never)).toBe(true)
		expect(pattern?.admin?.condition?.({}, { kind: 'goal' }, {} as never)).toBe(false)
	})

	it('keeps a fixed value non-negative and the currency an ISO 4217 code', () => {
		const fixed = deep(groupFields(collection.fields, 'value'), 'fixed') as NumberField
		expect(fixed.min).toBe(0)
		const currency = named(collection.fields, 'currency') as TextField
		const validate = currency.validate as (v: unknown, o: unknown) => true | string
		expect(validate('EUR', { req: fakeReq() })).toBe(true)
		expect(validate(undefined, { req: fakeReq() })).toBe(true)
		expect(validate('', { req: fakeReq() })).toBe(true)
		expect(validate('eur', { req: fakeReq() })).toBe('analytics:goalErrorCurrency')
		expect(validate('EURO', { req: fakeReq() })).toBe('analytics:goalErrorCurrency')
	})

	it('pins uniqueness in the database where the plugin owns the scope field', () => {
		expect(build().indexes).toEqual([{ fields: ['slug'], unique: true }])
		expect(build({ scoped: true }).indexes).toEqual([{ fields: ['slug', 'scope'], unique: true }])
		expect(build({ scoped: true, scopeField: 'tenant' }).indexes).toBeUndefined()
	})

	it('indexes the slug field only when no compound index covers it', () => {
		const slugIndex = (c: CollectionConfig) => (deep(c.fields, 'slug') as TextField).index
		// Both at once is an index-name conflict mongoose refuses at connect time.
		expect(slugIndex(build())).toBe(false)
		expect(slugIndex(build({ scoped: true }))).toBe(false)
		expect(slugIndex(build({ scoped: true, scopeField: 'tenant' }))).toBe(true)
	})

	it('keeps the scope field hidden, indexed text', () => {
		const scope = named(collection.fields, 'scope') as TextField | undefined
		expect(scope?.type).toBe('text')
		expect(scope?.index).toBe(true)
		expect(scope?.admin?.hidden).toBe(true)
	})

	it('invalidates the resolver cache on change and on delete', async () => {
		const onChange = vi.fn()
		const withHooks = build({ onChange })
		await withHooks.hooks?.afterChange?.[0]?.({ doc: {} } as never)
		await withHooks.hooks?.afterDelete?.[0]?.({ doc: {} } as never)
		expect(onChange).toHaveBeenCalledTimes(2)
	})

	it('stamps the resolved scope on create in scoped installs', async () => {
		const scoped = build({ scoped: true, resolveScope: async () => 'tenant-a' })
		const data = await scoped.hooks?.beforeChange?.[0]?.({
			data: { slug: 'demo' },
			operation: 'create',
			req: fakeReq(),
		} as never)
		expect(data).toEqual({ slug: 'demo', scope: 'tenant-a' })
	})

	it('applies access overrides over the defaults', () => {
		const read = () => true
		const custom = build({ access: { read } })
		expect(custom.access?.read).toBe(read)
		expect(custom.access?.create).not.toBe(read)
	})

	it('applies overrides last', () => {
		const custom = build({
			access: { read: () => true },
			overrides: (c) => ({ ...c, slug: 'conversions', admin: { ...c.admin, group: 'Marketing' } }),
		})
		expect(custom.slug).toBe('conversions')
		expect(custom.admin?.group).toBe('Marketing')
	})
})

describe('goals collection slug uniqueness', () => {
	const hookFor = (args: Partial<BuildGoalsCollectionArgs> = {}) => {
		const collection = build(args)
		const hook = collection.hooks?.beforeValidate?.[0]
		if (!hook) throw new Error('no beforeValidate hook')
		return hook
	}

	it('refuses a slug another document in the same scope already uses', async () => {
		const find = vi.fn(async () => ({ docs: [{ id: 'other' }] }))
		await expect(
			hookFor()({ data: { slug: 'demo' }, operation: 'create', req: fakeReq(find) } as never)
			// A ValidationError, so the admin shows the message on the slug field itself.
		).rejects.toMatchObject({
			data: { errors: [{ path: 'slug', message: 'analytics:goalErrorSlugTaken' }] },
		})
	})

	it('ignores the document being updated', async () => {
		const find = vi.fn(async (_args: { where: Where; pagination?: boolean }) => ({ docs: [] }))
		const data = await hookFor()({
			data: { slug: 'demo' },
			operation: 'update',
			originalDoc: { id: 'self' },
			req: fakeReq(find),
		} as never)
		expect(data).toEqual({ slug: 'demo' })
		const call = find.mock.calls[0]?.[0]
		expect(JSON.stringify(call?.where)).toContain('not_equals')
		// A paginated read would run its count and its find in parallel on the write's session.
		expect(call?.pagination).toBe(false)
	})

	it('scopes the lookup to the request scope in scoped installs', async () => {
		const find = vi.fn(async (_args: { where: Where; pagination?: boolean }) => ({ docs: [] }))
		await hookFor({ scoped: true, resolveScope: async () => 'tenant-a' })({
			data: { slug: 'demo' },
			operation: 'create',
			req: fakeReq(find),
		} as never)
		const where = find.mock.calls[0]?.[0]?.where
		expect(JSON.stringify(where)).toContain('tenant-a')
	})

	it('ignores a scope declared in the body by an ordinary tenant user', async () => {
		const find = vi.fn(async (_args: { where: Where }) => ({ docs: [] }))
		await hookFor({ scoped: true, resolveScope: async () => 'tenant-a' })({
			data: { slug: 'demo', scope: 'tenant-b' },
			operation: 'create',
			req: fakeReq(find),
		} as never)
		// Otherwise the answer ("slug taken" or not) reports whether another tenant owns the slug.
		const where = JSON.stringify(find.mock.calls[0]?.[0]?.where)
		expect(where).toContain('tenant-a')
		expect(where).not.toContain('tenant-b')
	})

	it('honours the scope a platform admin declares', async () => {
		const find = vi.fn(async (_args: { where: Where }) => ({ docs: [] }))
		await hookFor({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			platformRead: async () => true,
		})({
			data: { slug: 'demo', scope: 'tenant-b' },
			operation: 'create',
			req: fakeReq(find),
		} as never)
		const where = JSON.stringify(find.mock.calls[0]?.[0]?.where)
		expect(where).toContain('tenant-b')
		expect(where).not.toContain('tenant-a')
	})

	it('checks the install-wide neighbourhood for a platform write carrying no scope', async () => {
		const find = vi.fn(async (_args: { where: Where }) => ({ docs: [] }))
		await hookFor({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			platformRead: async () => true,
		})({ data: { slug: 'demo' }, operation: 'create', req: fakeReq(find) } as never)
		const where = JSON.stringify(find.mock.calls[0]?.[0]?.where)
		expect(where).not.toContain('tenant-a')
		expect(where).toContain('"scope":{"equals":null}')
	})

	it('does not query at all when the write carries no slug', async () => {
		const find = vi.fn(async () => ({ docs: [] }))
		await hookFor()({ data: {}, operation: 'update', req: fakeReq(find) } as never)
		expect(find).not.toHaveBeenCalled()
	})
})
