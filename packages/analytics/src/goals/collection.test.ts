import type {
	CheckboxField,
	CollectionConfig,
	Field,
	GroupField,
	NumberField,
	SelectField,
	TextField,
	Where,
} from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { keys, translations } from '../translations'
import { builtInStaticLabel } from '../translations/staticLabel'
import type { BuildGoalsCollectionArgs } from './collection'
import { buildGoalsCollection, GOALS_SLUG } from './collection'
import { MAX_PATTERN_GLOBSTARS, MAX_PATTERN_SEGMENTS } from './pathMatch'

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
	crossScope: async () => false,
}

const build = (overrides: Partial<BuildGoalsCollectionArgs> = {}) =>
	buildGoalsCollection({ slug: GOALS_SLUG, onChange: () => {}, ...unscopedArgs, ...overrides })

describe('buildGoalsCollection', () => {
	const collection = build()

	it('uses the given slug and admin-only access by default', async () => {
		expect(collection.slug).toBe('analytics-goals')
		const read = collection.access?.read
		const from = (user: unknown) =>
			({ req: { user, payload: { config: { admin: { user: 'users' } } } } }) as never
		expect(await read?.(from(null))).toBe(false)
		expect(await read?.(from({ id: 1, collection: 'users' }))).toBe(true)
		expect(await read?.(from({ id: 1, collection: 'customers' }))).toBe(false)
	})

	it('lists goals by name', () => {
		expect(collection.admin?.useAsTitle).toBe('name')
		expect(collection.admin?.defaultColumns).toEqual(['name', 'slug', 'match.kind', 'enabled'])
	})

	it('sits in the plugin nav group, named in every shipped language', () => {
		// `admin.group` takes no label function, so it carries the locale map rather than a key.
		const group = collection.admin?.group as Record<string, string>
		expect(group).toEqual(builtInStaticLabel(keys.adminGroup))
		expect(group.en).toBe('Analytics settings')
		expect(Object.keys(group).sort()).toEqual(Object.keys(translations).sort())
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

	it('refuses an address pattern over the matcher caps, in the editor language', () => {
		const pattern = named(groupFields(collection.fields, 'match'), 'pattern') as TextField
		const validate = pattern.validate as (v: unknown, o: unknown) => true | string
		const deepest = `/${Array(32).fill('a').join('/')}`
		expect(validate(deepest, { req: fakeReq() })).toBe(true)
		expect(validate('/**/a/**/b/**/c/**', { req: fakeReq() })).toBe(true)
		expect(validate(undefined, { req: fakeReq() })).toBe(true)
		expect(validate(`${deepest}/a`, { req: fakeReq() })).toBe('analytics:goalErrorPatternLimits')
		expect(validate('/**/a/**/b/**/c/**/d/**', { req: fakeReq() })).toBe(
			'analytics:goalErrorPatternLimits'
		)
	})

	it('leaves the limits to the caps in every locale rather than writing the numbers in', () => {
		for (const [locale, table] of Object.entries(translations)) {
			const message = table.analytics?.goalErrorPatternLimits ?? ''
			expect(message, locale).toContain('{{segments}}')
			expect(message, locale).toContain('{{globstars}}')
			expect(message, locale).not.toMatch(/\d/)
		}
	})

	it('fills the limits into the message from the matcher caps', () => {
		const pattern = named(groupFields(collection.fields, 'match'), 'pattern') as TextField
		const validate = pattern.validate as (v: unknown, o: unknown) => true | string
		const t = (key: string, vars?: Record<string, unknown>) => `${key} ${JSON.stringify(vars)}`
		expect(validate('/**/a/**/b/**/c/**/d/**', { req: { t } })).toBe(
			`analytics:goalErrorPatternLimits ${JSON.stringify({
				segments: MAX_PATTERN_SEGMENTS,
				globstars: MAX_PATTERN_GLOBSTARS,
			})}`
		)
	})

	it('keeps a fixed value non-negative and the currency an ISO 4217 code', () => {
		const fixed = deep(collection.fields, 'fixed') as NumberField
		expect(fixed.min).toBe(0)
		const currency = deep(collection.fields, 'currency') as TextField
		const validate = currency.validate as (v: unknown, o: unknown) => true | string
		expect(validate('EUR', { req: fakeReq() })).toBe(true)
		expect(validate(undefined, { req: fakeReq() })).toBe(true)
		expect(validate('', { req: fakeReq() })).toBe(true)
		expect(validate('eur', { req: fakeReq() })).toBe('analytics:goalErrorCurrency')
		expect(validate('EURO', { req: fakeReq() })).toBe('analytics:goalErrorCurrency')
	})

	it('asks for a currency once the goal carries an amount, and only then', () => {
		const currency = deep(collection.fields, 'currency') as TextField
		const validate = currency.validate as (v: unknown, o: unknown) => true | string
		const withData = (data: unknown) => ({ req: fakeReq(), data, siblingData: data })
		expect(validate('', withData({ value: { fixed: 10 } }))).toBe(
			'analytics:goalErrorCurrencyRequired'
		)
		expect(validate(null, withData({ value: { fixed: 0 } }))).toBe(
			'analytics:goalErrorCurrencyRequired'
		)
		expect(validate('EUR', withData({ value: { fixed: 10 } }))).toBe(true)
		expect(validate('eur', withData({ value: { fixed: 10 } }))).toBe('analytics:goalErrorCurrency')
		for (const data of [
			{},
			{ value: null },
			{ value: { prop: 'total' } },
			{ value: { fixed: null } },
		]) {
			expect(validate('', withData(data))).toBe(true)
		}
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

	it('leaves the scope field to the host when scopeField names one of its own', () => {
		const hostOwned = build({ scoped: true, scopeField: 'tenant' })
		expect(named(hostOwned.fields, 'scope')).toBeUndefined()
		expect(named(hostOwned.fields, 'tenant')).toBeUndefined()
	})

	it('reports the scopes a change or a delete touched', async () => {
		const onChange = vi.fn()
		const withHooks = build({ onChange })
		await withHooks.hooks?.afterChange?.[0]?.({ doc: {} } as never)
		await withHooks.hooks?.afterDelete?.[0]?.({ doc: {} } as never)
		expect(onChange).toHaveBeenCalledTimes(2)
	})

	it('stamps the resolved scope on create in scoped installs', async () => {
		const scoped = build({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			member: () => true,
		})
		const data = await scoped.hooks?.beforeChange?.[0]?.({
			data: { slug: 'demo' },
			operation: 'create',
			req: fakeReq(),
		} as never)
		expect(data).toEqual({ slug: 'demo', scope: 'tenant-a' })
	})

	// The same functions guard providers and goals, so a selector pointed at another tenant
	// opens neither collection there.
	it('refuses a scope its user does not belong to, on read and on create', async () => {
		const scoped = build({
			scoped: true,
			resolveScope: async () => 'tenant-b',
			member: ({ scope }) => scope === 'tenant-a',
		})
		const req = { user: { id: 1 } }
		expect(await scoped.access?.read?.({ req } as never)).toBe(false)
		expect(await scoped.access?.create?.({ req } as never)).toBe(false)
		await expect(
			scoped.hooks?.beforeChange?.[0]?.({
				data: { slug: 'demo' },
				operation: 'create',
				req: fakeReq(),
			} as never)
		).rejects.toThrow(/does not belong to/)
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
		await hookFor({ scoped: true, resolveScope: async () => 'tenant-a', member: () => true })({
			data: { slug: 'demo' },
			operation: 'create',
			req: fakeReq(find),
		} as never)
		const where = find.mock.calls[0]?.[0]?.where
		expect(JSON.stringify(where)).toContain('tenant-a')
	})

	it('ignores a scope declared in the body by an ordinary tenant user', async () => {
		const find = vi.fn(async (_args: { where: Where }) => ({ docs: [] }))
		await hookFor({ scoped: true, resolveScope: async () => 'tenant-a', member: () => true })({
			data: { slug: 'demo', scope: 'tenant-b' },
			operation: 'create',
			req: fakeReq(find),
		} as never)
		// Otherwise the answer ("slug taken" or not) reports whether another tenant owns the slug.
		const where = JSON.stringify(find.mock.calls[0]?.[0]?.where)
		expect(where).toContain('tenant-a')
		expect(where).not.toContain('tenant-b')
	})

	// "Slug taken" in a tenant the user merely selected would say what that tenant owns.
	it('never checks a scope the user selected but does not belong to', async () => {
		const find = vi.fn(async (_args: { where: Where }) => ({ docs: [] }))
		await hookFor({ scoped: true, resolveScope: async () => 'tenant-b', member: () => false })({
			data: { slug: 'demo' },
			operation: 'create',
			req: fakeReq(find),
		} as never)
		expect(JSON.stringify(find.mock.calls[0]?.[0]?.where)).not.toContain('tenant-b')
	})

	it('honours the scope a platform admin declares', async () => {
		const find = vi.fn(async (_args: { where: Where }) => ({ docs: [] }))
		await hookFor({
			scoped: true,
			resolveScope: async () => 'tenant-a',
			crossScope: async () => true,
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
			crossScope: async () => true,
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

describe('goals collection field overrides', () => {
	// The list is the editor's own goals and nothing else: no explainer above it, no table of
	// the built-in ones, which the goal picker already offers under their own heading.
	it('opens on the list itself, with no description and nothing above the table', () => {
		const collection = build()
		expect(collection.admin?.description).toBeUndefined()
		expect(collection.admin?.components).toBeUndefined()
	})

	it('puts enabled in the sidebar', () => {
		const collection = build()
		expect((deep(collection.fields, 'enabled') as CheckboxField).admin?.position).toBe('sidebar')
	})

	it('hands each override the plugin default and takes what it returns', () => {
		const collection = build({
			fields: {
				name: ({ field }): Field => ({ ...(field as TextField), label: 'Conversion' }),
				enabled: ({ field }): Field => ({ ...(field as CheckboxField), defaultValue: false }),
			},
		})
		expect((deep(collection.fields, 'name') as TextField).label).toBe('Conversion')
		expect((deep(collection.fields, 'enabled') as CheckboxField).defaultValue).toBe(false)
	})

	it('accepts a slug replaced by a sidebar row holding a hidden checkbox', () => {
		const collection = build({
			fields: {
				slug: ({ field }): Field => ({
					type: 'row',
					admin: { position: 'sidebar' },
					fields: [
						{
							name: 'generateSlug',
							type: 'checkbox',
							defaultValue: true,
							admin: { hidden: true },
						},
						{
							...(field as TextField),
							admin: { components: { Field: { path: '@/fields/slug#SlugField' } } },
						},
					],
				}),
			},
		})
		// The replacement is a layout field, so it cannot share the name row and stands alone.
		const row = collection.fields.find(
			(field) => field.type === 'row' && field.admin?.position === 'sidebar'
		)
		expect(row).toBeDefined()
		expect(deep(collection.fields, 'slug')).toBeDefined()
		expect(deep(collection.fields, 'generateSlug')).toBeDefined()
	})

	it('still enforces kebab-case and uniqueness for a replaced slug field', async () => {
		const collection = build({
			fields: { slug: ({ field }): Field => ({ ...(field as TextField), validate: undefined }) },
		})
		const hook = collection.hooks?.beforeValidate?.[0] as (args: unknown) => Promise<unknown>
		const find = vi.fn(async () => ({ docs: [] }))
		await expect(
			hook({ data: { slug: 'Book Demo' }, operation: 'create', req: fakeReq(find) })
		).rejects.toThrow()
		expect(find).not.toHaveBeenCalled()
		await expect(
			hook({ data: { slug: 'book-demo' }, operation: 'create', req: fakeReq(find) })
		).resolves.toBeDefined()
		expect(find).toHaveBeenCalledTimes(1)
	})

	it('fails the boot when a slug replacement drops the slug field', () => {
		expect(() =>
			build({ fields: { slug: (): Field => ({ name: 'handle', type: 'text' }) } })
		).toThrow(/must return a field named "slug"/)
	})
})

/** Every stored path in the tree: named groups nest, rows and collapsibles do not. */
const dataPaths = (fields: Field[], prefix = ''): string[] =>
	fields.flatMap((field) => {
		if (field.type === 'group' && 'name' in field) {
			return dataPaths(field.fields, `${prefix}${field.name}.`)
		}
		if ('name' in field) {
			return [`${prefix}${field.name}`]
		}
		return 'fields' in field ? dataPaths(field.fields, prefix) : []
	})

const shown = (field: Field | undefined, data: Record<string, unknown> = {}): boolean =>
	field?.admin?.condition?.(data, {}, {} as never) !== false

describe('goals collection amount', () => {
	const valueGroup = (collection: CollectionConfig) =>
		named(collection.fields, 'value') as GroupField

	it('stores what it always stored: value.fixed, value.prop and a top-level currency', () => {
		const fields = build().fields
		expect(dataPaths(fields)).toEqual([
			'name',
			'slug',
			'enabled',
			'browser',
			'match.kind',
			'match.name',
			'match.pattern',
			'value.fixed',
			'value.prop',
			'currency',
			'scope',
		])
		expect((deep(fields, 'fixed') as NumberField).type).toBe('number')
		expect((deep(fields, 'prop') as TextField).type).toBe('text')
		expect((named(fields, 'currency') as TextField).type).toBe('text')
	})

	it('has no collapsible, and the value group no heading or gutter of its own', () => {
		const collection = build()
		expect(collection.fields.some((field) => field.type === 'collapsible')).toBe(false)
		expect(valueGroup(collection).label).toBe(false)
		expect(valueGroup(collection).admin?.hideGutter).toBe(true)
	})

	it('draws the amount as the Amount control, which edits the hidden top-level currency', () => {
		const fields = build().fields
		expect((deep(fields, 'fixed') as NumberField).admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/client#GoalAmountField',
			clientProps: { currencyPath: '../currency' },
		})
		const currency = named(fields, 'currency') as TextField
		// Hidden rather than disabled, so the form keeps its value and saves it.
		expect(currency.admin?.hidden).toBe(true)
		expect(currency.admin?.disabled).toBeUndefined()
		expect(shown(currency)).toBe(true)
	})

	it('hands the control the reporting currency when the install has one fixed code', () => {
		const fixed = deep(build({ defaultCurrency: 'EUR' }).fields, 'fixed') as NumberField
		expect(fixed.admin?.components?.Field).toEqual({
			path: '@10x-media/analytics/client#GoalAmountField',
			clientProps: { currencyPath: '../currency', defaultCurrency: 'EUR' },
		})
	})

	it('offers the amount inside the action for an action trigger only', () => {
		const prop = deep(build().fields, 'prop')
		expect(shown(prop, { match: { kind: 'event' } })).toBe(true)
		expect(shown(prop, { match: { kind: 'goal' } })).toBe(false)
		expect(shown(prop, { match: { kind: 'path' } })).toBe(false)
		expect(shown(prop)).toBe(false)
	})

	it('hides the amount and its currency while the install measures no money', () => {
		const off = build({ revenue: false })
		expect(shown(valueGroup(off))).toBe(false)
		expect(shown(named(off.fields, 'currency'))).toBe(false)
		// Hidden rather than removed, so a goal that already carries an amount keeps it.
		expect(dataPaths(off.fields)).toEqual(dataPaths(build().fields))
		expect(valueGroup(build()).admin?.condition).toBeUndefined()
	})

	it('hands the value and currency overrides the defaults and keeps what they return', () => {
		const handed: Field[] = []
		const collection = build({
			fields: {
				value: ({ field }): Field => {
					handed.push(field)
					return { ...(field as GroupField), label: 'Worth' }
				},
				currency: ({ field }): Field => {
					handed.push(field)
					return { ...(field as TextField), defaultValue: 'EUR' }
				},
			},
		})
		const [value, currency] = handed
		expect((deep([value as Field], 'fixed') as NumberField).admin?.components?.Field).toMatchObject(
			{
				path: '@10x-media/analytics/client#GoalAmountField',
			}
		)
		expect((currency as TextField).admin?.hidden).toBe(true)
		expect(valueGroup(collection).label).toBe('Worth')
		expect((named(collection.fields, 'currency') as TextField).defaultValue).toBe('EUR')
	})

	it('lets a host replace the whole value group, and still hides it while money is off', () => {
		const replacement = (): Field => ({
			name: 'value',
			type: 'group',
			fields: [{ name: 'fixed', type: 'number' }],
		})
		const fixed = deep(build({ fields: { value: replacement } }).fields, 'fixed') as NumberField
		expect(fixed.admin?.components?.Field).toBeUndefined()
		expect(shown(valueGroup(build({ revenue: false, fields: { value: replacement } })))).toBe(false)
	})
})
