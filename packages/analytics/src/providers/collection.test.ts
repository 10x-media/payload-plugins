import {
	type CollectionAfterChangeHook,
	type CollectionAfterDeleteHook,
	createClientField,
	type Field,
	type FieldAccess,
	type PayloadRequest,
	type TextField,
} from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { createStaticLabels } from '../translations/staticLabel'
import type { BuildProvidersCollectionArgs, BuildSecretField } from './collection'
import { analyticsProviderFields, buildProvidersCollection } from './collection'
import { PROVIDER_IDS } from './factory'
import { CONNECTION_PATHS, SECRET_PATHS } from './secrets'

const named = (fields: Field[] | undefined, name: string): Field | undefined =>
	fields?.find((f) => 'name' in f && f.name === name)

/** Admin metadata as the tests read it; the Field union hides it behind each field type. */
const adminOf = (
	field: Field | undefined
): { position?: string; description?: unknown; width?: string } =>
	(field?.admin ?? {}) as { position?: string; description?: unknown; width?: string }

const labelOf = (field: Field | undefined): unknown =>
	(field as { label?: unknown } | undefined)?.label

/** Echoes the source field back with a marker so tests can assert delegation. */
const fakeBuildSecret: BuildSecretField = (source) => [{ ...source, custom: { fake: source.type } }]

type TaggedField = Field & { custom?: { fake?: unknown } }

/** Walks the built field tree and collects `<group>.<field>` paths for every field the fake buildSecret tagged. */
const collectTaggedPaths = (fields: Field[] | undefined, prefix: string[] = []): string[] =>
	(fields ?? []).flatMap((field) => {
		const tagged = field as TaggedField
		const path = 'name' in field && field.name ? [...prefix, field.name] : prefix
		const own = tagged.custom?.fake ? [path.join('.')] : []
		const nested = 'fields' in field ? collectTaggedPaths(field.fields, path) : []
		return [...own, ...nested]
	})

const unscopedArgs: Pick<
	BuildProvidersCollectionArgs,
	'scoped' | 'scopeField' | 'resolveScope' | 'crossScope' | 'buildSecret' | 'isSealed'
> = {
	scoped: false,
	scopeField: 'scope',
	resolveScope: async () => null,
	crossScope: async () => false,
	buildSecret: fakeBuildSecret,
	isSealed: () => false,
}

/** A request from a user of `collection`, on an install whose admin collection is `users`. */
const requestFrom = (collection: string | null) =>
	({
		req: {
			user: collection === null ? null : { id: 1, collection },
			payload: { config: { admin: { user: 'users' } } },
		},
	}) as never

/** Every field carrying `marker` as its update access, as `<group>.<field>` paths. */
const pathsWithAccess = (
	fields: Field[] | undefined,
	marker: FieldAccess,
	prefix: string[] = []
): string[] =>
	(fields ?? []).flatMap((field) => {
		const path = 'name' in field && field.name ? [...prefix, field.name] : prefix
		const access = 'access' in field ? field.access : undefined
		const own = access?.update === marker ? [path.join('.')] : []
		const nested = 'fields' in field ? pathsWithAccess(field.fields, marker, path) : []
		return [...own, ...nested]
	})

/** Every `host` field in the built tree, wherever it sits. */
const hostFields = (fields: Field[] | undefined): TextField[] =>
	(fields ?? []).flatMap((field) => {
		const own = field.type === 'text' && field.name === 'host' ? [field] : []
		return [...own, ...('fields' in field ? hostFields(field.fields) : [])]
	})

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
		expect(await read?.(requestFrom(null))).toBe(false)
		expect(await read?.(requestFrom('users'))).toBe(true)
	})

	it('admits no user of a second auth collection to any row or create', async () => {
		for (const operation of ['read', 'create', 'update', 'delete'] as const) {
			expect(await collection.access?.[operation]?.(requestFrom('customers'))).toBe(false)
		}
	})

	it('validates every host field as an https address, translated', () => {
		const hosts = hostFields(collection.fields)
		expect(hosts).toHaveLength(3)
		const req = { req: { t: (key: string) => key } } as never
		for (const host of hosts) {
			const validate = host.validate as (value: unknown, options: unknown) => true | string
			expect(validate('https://analytics.example.com', req)).toBe(true)
			expect(validate('https://example.com/analytics', req)).toBe(true)
			expect(validate('', req)).toBe(true)
			expect(validate('http://analytics.example.com', req)).toBe(
				'analytics:providerErrorHostInsecure'
			)
			expect(validate('https://analytics.example.com/?a=1', req)).toBe(
				'analytics:providerErrorHostFormat'
			)
		}
	})

	it('accepts http hosts only where private networks are allowed', () => {
		const open = buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {},
			...unscopedArgs,
			allowPrivateNetwork: true,
		})
		const req = { req: { t: (key: string) => key } } as never
		for (const host of hostFields(open.fields)) {
			const validate = host.validate as (value: unknown, options: unknown) => true | string
			expect(validate('http://umami:3000', req)).toBe(true)
		}
	})

	it('puts the connection access on exactly the CONNECTION_PATHS fields', () => {
		const update: FieldAccess = () => false
		const gated = buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {},
			...unscopedArgs,
			connectionAccess: { update },
		})
		expect(new Set(pathsWithAccess(gated.fields, update))).toEqual(
			new Set(CONNECTION_PATHS.map((entry) => entry.path))
		)
		expect(pathsWithAccess(collection.fields, update)).toEqual([])
	})

	it('clears secrets on retarget in a hook that runs after the scope stamp', async () => {
		const sealed = 'sealed-ciphertext'
		const withSeal = buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {},
			...unscopedArgs,
			isSealed: (value) => value === sealed,
		})
		const [stamp, retarget] = withSeal.hooks?.beforeChange ?? []
		expect(withSeal.hooks?.beforeChange).toHaveLength(2)
		const data = {
			provider: 'plausible',
			plausible: { host: 'https://b.example.com', siteId: 's', apiKey: sealed },
		}
		const originalDoc = {
			provider: 'plausible',
			plausible: { host: 'https://a.example.com', siteId: 's' },
		}
		const args = { data, originalDoc, operation: 'update', req: {} } as never
		expect(await stamp?.(args)).toBe(data)
		expect(await retarget?.(args)).toEqual({
			provider: 'plausible',
			plausible: { host: 'https://b.example.com', siteId: 's', apiKey: null },
		})
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

	it('explains the native choice with a note that stores nothing', () => {
		const note = collection.fields.find(
			(field) => field.type === 'group' && !('name' in field && field.name)
		)
		expect(note).toBeDefined()
		expect(note && 'fields' in note ? note.fields : undefined).toEqual([])
		expect(adminOf(note).description).toBeDefined()
		const condition = note?.admin?.condition
		expect(condition?.({ provider: 'native' }, { provider: 'native' }, {} as never)).toBe(true)
		expect(condition?.({ provider: 'ga4' }, { provider: 'ga4' }, {} as never)).toBe(false)
	})

	it('disables duplicate (a duplicate could never carry the write-only credentials)', () => {
		expect(collection.disableDuplicate).toBe(true)
	})

	it('keeps the scope field hidden, indexed text', () => {
		const scope = named(collection.fields, 'scope') as TextField | undefined
		expect(scope?.type).toBe('text')
		expect(scope?.index).toBe(true)
		expect(scope?.admin?.hidden).toBe(true)
	})

	it('leaves the scope field to the host when scopeField names one of its own', () => {
		const hostOwned = buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {},
			...unscopedArgs,
			scoped: true,
			scopeField: 'tenant',
		})
		expect(named(hostOwned.fields, 'scope')).toBeUndefined()
		expect(named(hostOwned.fields, 'tenant')).toBeUndefined()
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

	// Payload drops a function description from the client field, and the write-only editor reads
	// the client field's own: a credential's help has to reach the browser as strings.
	it("keeps each credential's help on the client field, in every language, install strings first", () => {
		const relabeled = buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {},
			...unscopedArgs,
			staticLabel: createStaticLabels({
				plugin: { de: { [keys.providerFieldTokenHelp]: 'Eigener Hilfetext' } },
				unbundled: ['nl'],
			}),
		})
		const secrets = collectTaggedPaths(relabeled.fields)
		expect(secrets.length).toBeGreaterThan(0)
		const fieldAt = (path: string): Field | undefined =>
			path.split('.').reduce<Field | undefined>((found, name) => {
				const within =
					found === undefined ? relabeled.fields : 'fields' in found ? found.fields : []
				const direct = named(within, name)
				if (direct) {
					return direct
				}
				// A row holds its fields without a name of its own.
				for (const field of within) {
					const nested =
						'fields' in field && !('name' in field) ? named(field.fields, name) : undefined
					if (nested) {
						return nested
					}
				}
				return undefined
			}, undefined)
		const i18n = { language: 'en', fallbackLanguage: 'en', t: (key: string) => key }
		for (const path of secrets) {
			const field = fieldAt(path)
			if (!field) {
				throw new Error(`no field at ${path}`)
			}
			const client = createClientField({
				defaultIDType: 'text',
				field,
				i18n: i18n as never,
				importMap: {},
			})
			const description = (client as { admin?: { description?: unknown } }).admin?.description
			expect(description, path).toMatchObject({ en: expect.any(String), zh: expect.any(String) })
			expect((description as Record<string, string>).nl, path).toBe(
				(description as Record<string, string>).en
			)
		}
		const token = fieldAt('umami.token')
		expect(adminOf(token).description).toMatchObject({ de: 'Eigener Hilfetext' })
	})

	// Public capture config, not credentials: they reach the browser in the snippet, so they
	// must stay plain text (a sealed field would be unreadable to the tracker config).
	it('carries the public capture fields as plain text on posthog, plausible and ga4', () => {
		const inGroup = (provider: string, name: string): Field | undefined => {
			const group = named(collection.fields, provider)
			const fields = group && 'fields' in group ? group.fields : []
			const direct = named(fields, name)
			if (direct) {
				return direct
			}
			for (const field of fields) {
				const nested = 'fields' in field ? named(field.fields, name) : undefined
				if (nested) {
					return nested
				}
			}
			return undefined
		}

		const projectToken = inGroup('posthog', 'projectToken')
		expect(projectToken?.type).toBe('text')
		expect((projectToken as TaggedField | undefined)?.custom?.fake).toBeUndefined()

		const region = inGroup('posthog', 'region')
		expect(region?.type).toBe('select')
		expect((region as { options?: Array<{ value: string }> } | undefined)?.options).toEqual([
			{ label: 'US', value: 'us' },
			{ label: 'EU', value: 'eu' },
		])

		for (const name of ['domain', 'scriptId']) {
			const field = inGroup('plausible', name)
			expect(field?.type).toBe('text')
			expect((field as TaggedField | undefined)?.custom?.fake).toBeUndefined()
		}
		// Two ways to turn Plausible's tracking on, so each says what it takes and which one wins.
		const helpKey = (name: string): unknown => {
			const description = adminOf(inGroup('plausible', name)).description
			return typeof description === 'function' ? description({ t: (key: string) => key }) : null
		}
		expect(helpKey('domain')).toBe('analytics:providerFieldDomainHelp')
		expect(helpKey('scriptId')).toBe('analytics:providerFieldScriptIdHelp')

		const measurementId = inGroup('ga4', 'measurementId')
		expect(measurementId?.type).toBe('text')
		expect((measurementId as TaggedField | undefined)?.custom?.fake).toBeUndefined()
	})

	it('validates the plausible revenue currency as an ISO 4217 code', () => {
		const group = named(collection.fields, 'plausible')
		const fields = group && 'fields' in group ? group.fields : []
		const currency = named(fields, 'revenueCurrency') as TextField | undefined
		expect(currency?.type).toBe('text')
		const validate = currency?.validate as
			| ((value: unknown, options: unknown) => true | string)
			| undefined
		const req = { req: { t: (key: string) => key } } as never
		expect(validate?.('EUR', req)).toBe(true)
		expect(validate?.('', req)).toBe(true)
		expect(validate?.('eur', req)).toBe('analytics:goalErrorCurrency')
		expect(validate?.('EURO', req)).toBe('analytics:goalErrorCurrency')
	})

	it('validates the ga4 measurement id as a bare token', () => {
		const group = named(collection.fields, 'ga4')
		const fields = group && 'fields' in group ? group.fields : []
		const measurementId = named(fields, 'measurementId') as TextField | undefined
		const validate = measurementId?.validate as
			| ((value: unknown, options: unknown) => true | string)
			| undefined
		const req = { req: { t: (key: string) => key } } as never
		expect(validate?.('G-AB12CD34', req)).toBe(true)
		expect(validate?.('', req)).toBe(true)
		expect(validate?.('G-AB12</script>', req)).toBe('analytics:providerErrorMeasurementId')
		expect(validate?.('G AB12', req)).toBe('analytics:providerErrorMeasurementId')
	})

	it('validates the plausible script id as a bare token, which no path can be', () => {
		const group = named(collection.fields, 'plausible')
		const fields = group && 'fields' in group ? group.fields : []
		const row = fields.find((field) => 'fields' in field && named(field.fields, 'scriptId'))
		const scriptId = row && 'fields' in row ? named(row.fields, 'scriptId') : undefined
		const validate = (scriptId as TextField | undefined)?.validate as
			| ((value: unknown, options: unknown) => true | string)
			| undefined
		const req = { req: { t: (key: string) => key } } as never
		expect(validate?.('RsZm6Pd9-dz_Rp', req)).toBe(true)
		expect(validate?.('', req)).toBe(true)
		for (const value of [
			'x/../../../../../../api/media/file/evil',
			'x?callback=',
			'a.b',
			'x'.repeat(65),
		]) {
			expect(validate?.(value, req)).toBe('analytics:providerErrorScriptId')
		}
	})

	it('keeps SECRET_PATHS in parity with the collection secret fields', () => {
		const taggedPaths = collectTaggedPaths(collection.fields)
		expect(new Set(taggedPaths)).toEqual(new Set(SECRET_PATHS.map((s) => s.path)))
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

	// Both decide what the rest of the document even means, so they belong beside the save
	// button rather than in a row above fields that are conditional on them.
	it('puts provider and enabled in the sidebar, each with a description', () => {
		for (const name of ['provider', 'enabled']) {
			const admin = adminOf(named(collection.fields, name))
			expect(admin.position).toBe('sidebar')
			expect(admin.description).toBeDefined()
			expect(admin.width).toBeUndefined()
		}
	})

	it('describes the collection and every field a reader would have to guess at', () => {
		expect(collection.admin?.description).toBeDefined()
		expect(adminOf(named(collection.fields, 'name')).description).toBeDefined()
		const posthog = named(collection.fields, 'posthog')
		const fields = posthog && 'fields' in posthog ? posthog.fields : []
		const scopeProperty = named(fields, 'scopeProperty')
		expect(scopeProperty?.type).toBe('text')
		expect(adminOf(scopeProperty).description).toBeDefined()
	})

	it('replaces one default field at a time through fields, before overrides', () => {
		const custom = buildProvidersCollection({
			slug: 'analytics-providers',
			fields: {
				enabled: ({ field }) => ({ ...field, label: 'Live' }),
				name: () => ({ name: 'name', type: 'text', label: 'Label' }),
			},
			onChange: () => {},
			...unscopedArgs,
		})
		expect(labelOf(named(custom.fields, 'enabled'))).toBe('Live')
		expect(labelOf(named(custom.fields, 'name'))).toBe('Label')
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

describe('analyticsProviderFields', () => {
	it('matches the collection field list, so a host store cannot drift from it', () => {
		const fields = analyticsProviderFields({ buildSecret: fakeBuildSecret, scopeField: true })
		const collection = buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {},
			...unscopedArgs,
		})
		expect(fields.map((f) => ('name' in f ? f.name : f.type))).toEqual(
			collection.fields.map((f) => ('name' in f ? f.name : f.type))
		)
	})

	it('leaves the credentials plain text and the scope field out by default', () => {
		const fields = analyticsProviderFields()
		expect(named(fields, 'scope')).toBeUndefined()
		const plausible = named(fields, 'plausible')
		const rows = plausible && 'fields' in plausible ? plausible.fields : []
		const row = rows[0]
		const apiKey = row && 'fields' in row ? named(row.fields, 'apiKey') : undefined
		expect(apiKey?.type).toBe('text')
		expect((apiKey as TaggedField | undefined)?.custom?.fake).toBeUndefined()
	})

	it('takes connectionAccess as one function or as { create, update }, like the plugin option', () => {
		const access: FieldAccess = () => false
		const connection = new Set(CONNECTION_PATHS.map((entry) => entry.path))
		expect(
			new Set(pathsWithAccess(analyticsProviderFields({ connectionAccess: access }), access))
		).toEqual(connection)
		expect(
			new Set(
				pathsWithAccess(analyticsProviderFields({ connectionAccess: { update: access } }), access)
			)
		).toEqual(connection)
		expect(
			pathsWithAccess(analyticsProviderFields({ connectionAccess: { create: access } }), access)
		).toEqual([])
		expect(() =>
			analyticsProviderFields({ connectionAccess: { delete: access } as never })
		).toThrow(
			/analyticsProviderFields\(\{ connectionAccess \}\)\.delete is not an option; analyticsProviderFields\(\{ connectionAccess \}\) takes create and update/
		)
	})

	it('accepts http hosts once allowPrivateNetwork is set', () => {
		const req = { req: { t: (key: string) => key } } as never
		for (const [allowPrivateNetwork, expected] of [
			[true, true],
			[false, 'analytics:providerErrorHostInsecure'],
		] as const) {
			for (const host of hostFields(analyticsProviderFields({ allowPrivateNetwork }))) {
				const validate = host.validate as (value: unknown, options: unknown) => true | string
				expect(validate('http://umami:3000', req)).toBe(expected)
			}
		}
	})
})

type SelectValidate = (value: unknown, options: unknown) => true | string

/** The provider select of a field list, with its validate as the tests call it. */
const providerSelect = (fields: Field[]) => {
	const field = named(fields, 'provider')
	if (field?.type !== 'select') throw new Error('no provider select')
	const validate = field.validate as SelectValidate | undefined
	const check = (value: unknown) =>
		validate?.(value, {
			req: { t: (key: string) => key },
			options: field.options,
			required: true,
			data: {},
			siblingData: {},
		})
	return {
		values: field.options.map((option) => (typeof option === 'string' ? option : option.value)),
		offered: (stored?: string) =>
			(
				field.filterOptions?.({
					data: { provider: stored },
					options: field.options,
					req: {} as PayloadRequest,
					siblingData: {},
				}) ?? field.options
			).map((option) => (typeof option === 'string' ? option : option.value)),
		defaultValue:
			typeof field.defaultValue === 'function'
				? field.defaultValue({} as never)
				: field.defaultValue,
		validate,
		check,
	}
}

describe('servable provider types', () => {
	it('offers every type with native first and adds no check of its own by default', () => {
		for (const fields of [
			analyticsProviderFields(),
			buildProvidersCollection({ slug: 'p', onChange: () => {}, ...unscopedArgs }).fields,
		]) {
			const select = providerSelect(fields)
			expect(select.values).toEqual(['native', 'plausible', 'umami', 'ga4', 'posthog'])
			expect(select.defaultValue).toBe('native')
			expect(select.validate).toBeUndefined()
		}
	})

	it('offers only the served types in their order, the first as the default', () => {
		const select = providerSelect(
			buildProvidersCollection({
				slug: 'p',
				onChange: () => {},
				...unscopedArgs,
				types: ['umami', 'plausible'],
			}).fields
		)
		expect(select.offered()).toEqual(['umami', 'plausible'])
		expect(select.offered('ga4')).toEqual(['umami', 'plausible', 'ga4'])
		expect(select.defaultValue).toBe('umami')
	})

	it('keeps every type in the schema however few are offered, so no column changes', () => {
		const select = providerSelect(analyticsProviderFields({ types: ['umami'] }))
		expect(select.values).toEqual([...PROVIDER_IDS])
	})

	it('refuses a save of a type the install cannot serve by name, and checks the rest as a select', () => {
		const { check } = providerSelect(analyticsProviderFields({ types: ['plausible', 'umami'] }))
		expect(check('native')).toBe(keys.providerErrorTypeUnserved)
		expect(check('ga4')).toBe(keys.providerErrorTypeUnserved)
		expect(check('umami')).toBe(true)
		expect(check(undefined)).not.toBe(true)
	})

	it('checks analyticsProviderFields({ types }) like the plugin option', () => {
		expect(() => analyticsProviderFields({ types: ['matomo'] as never })).toThrow(
			/analyticsProviderFields\(\{ types \}\) lists "matomo", which is no provider type/
		)
		expect(() => analyticsProviderFields({ types: [] })).toThrow(/leaves no provider type/)
	})
})

describe('the default-for-this-site flag', () => {
	const scopedArgs = {
		...unscopedArgs,
		scoped: true,
		resolveScope: async () => 'tenant-a',
		member: () => true,
	}
	const scoped = (over: Partial<BuildProvidersCollectionArgs> = {}) =>
		buildProvidersCollection({
			slug: 'analytics-providers',
			onChange: () => {},
			...scopedArgs,
			...over,
		})

	const hookOf = (collection: ReturnType<typeof scoped>) => {
		const hook = collection.hooks?.beforeValidate?.[0] as
			| ((args: unknown) => Promise<unknown>)
			| undefined
		if (!hook) throw new Error('no beforeValidate hook')
		return hook
	}

	const reqWith = (docs: unknown[]) => {
		const find = vi.fn(async (_args: { where: unknown; pagination?: boolean }) => ({ docs }))
		return { find, req: { t: (key: string) => key, payload: { find } } }
	}

	it('is a sidebar checkbox after enabled, off by default, on a scoped install only', () => {
		const fields = scoped().fields
		const names = fields.map((f) => ('name' in f ? f.name : f.type))
		expect(names.indexOf('isDefault')).toBe(names.indexOf('enabled') + 1)
		const flag = named(fields, 'isDefault')
		expect(flag?.type).toBe('checkbox')
		expect((flag as { defaultValue?: unknown }).defaultValue).toBe(false)
		expect(adminOf(flag).position).toBe('sidebar')
		expect(adminOf(flag).description).toBeDefined()
		const unscoped = buildProvidersCollection({ slug: 'p', onChange: () => {}, ...unscopedArgs })
		expect(named(unscoped.fields, 'isDefault')).toBeUndefined()
		expect(unscoped.hooks?.beforeValidate).toBeUndefined()
	})

	it('takes defaultAccess as its field access, and is replaceable through fields', () => {
		const access = { update: () => false }
		const flagOf = (collection: ReturnType<typeof scoped>) =>
			named(collection.fields, 'isDefault') as { access?: unknown } | undefined
		expect(flagOf(scoped({ defaultAccess: access }))?.access).toBe(access)
		expect(flagOf(scoped())?.access).toBeUndefined()
		const relabeled = scoped({
			fields: { isDefault: ({ field }) => ({ ...field, label: 'Main' }) },
		})
		expect(labelOf(named(relabeled.fields, 'isDefault'))).toBe('Main')
	})

	it('refuses a second flagged document in the same scope on the flag itself', async () => {
		const { find, req } = reqWith([{ id: 'other' }])
		await expect(
			hookOf(scoped())({ data: { isDefault: true }, operation: 'create', req })
		).rejects.toMatchObject({
			data: { errors: [{ path: 'isDefault', message: keys.providerErrorDefaultTaken }] },
		})
		const call = find.mock.calls[0]?.[0]
		const where = JSON.stringify(call?.where)
		expect(where).toContain('"isDefault":{"equals":true}')
		expect(where).toContain('tenant-a')
		expect(call?.pagination).toBe(false)
	})

	it('looks nothing up for an unflagged write, and leaves the flagged document itself out', async () => {
		const hook = hookOf(scoped())
		const unflagged = reqWith([{ id: 'other' }])
		await expect(
			hook({
				data: { isDefault: false },
				originalDoc: { isDefault: true },
				operation: 'update',
				req: unflagged.req,
			})
		).resolves.toEqual({ isDefault: false })
		expect(unflagged.find).not.toHaveBeenCalled()
		const self = reqWith([])
		await hook({
			data: { name: 'Renamed' },
			originalDoc: { id: 'self', isDefault: true },
			operation: 'update',
			req: self.req,
		})
		expect(JSON.stringify(self.find.mock.calls[0]?.[0]?.where)).toContain('"not_equals":"self"')
	})
})
