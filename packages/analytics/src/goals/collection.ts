import type {
	CollectionBeforeValidateHook,
	CollectionConfig,
	CompoundIndex,
	Field,
	PayloadRequest,
	TextFieldSingleValidation,
	Where,
} from 'payload'
import { ValidationError } from 'payload'
import type { ProviderAccessArgs } from '../providers/access'
import { providerCreateAccess, providerRowAccess } from '../providers/access'
import { stampScope } from '../providers/stampScope'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { validateCurrency } from './currency'
import { goalScopeWhere } from './resolver'
import { GOAL_SLUG_PATTERN } from './types'

export const GOALS_SLUG = 'analytics-goals'

export interface BuildGoalsCollectionArgs extends ProviderAccessArgs {
	slug: string
	access?: Partial<CollectionConfig['access']>
	overrides?: (collection: CollectionConfig) => CollectionConfig
	/** Called after any change or delete so the merged resolver drops its cached goals. */
	onChange: () => void
}

const validateSlug: TextFieldSingleValidation = (value, { req }) =>
	typeof value === 'string' && GOAL_SLUG_PATTERN.test(value)
		? true
		: asTranslate(req.t)(keys.goalErrorSlug)

const asScope = (value: unknown): string | null =>
	value === null || value === undefined || value === '' ? null : String(value)

/**
 * The scope the stamp will land the write in, resolved with stampScope's precedence. Only a
 * platform admin's declared scope is honoured: taking an ordinary tenant's body scope on
 * trust would turn "slug taken" into an oracle for what another tenant owns, since the stamp
 * refuses the write either way.
 */
const writeScope = async (
	args: BuildGoalsCollectionArgs,
	write: {
		data?: Record<string, unknown>
		originalDoc?: Record<string, unknown>
		req: PayloadRequest
	}
): Promise<string | null> => {
	const { data, originalDoc, req } = write
	try {
		if (await args.platformRead({ req })) {
			// No declared scope means an install-wide goal, not one in whatever scope the
			// admin's own request happens to resolve to.
			return asScope(data?.[args.scopeField]) ?? asScope(originalDoc?.[args.scopeField])
		}
		return asScope(await args.resolveScope(req))
	} catch {
		return null
	}
}

/**
 * Slugs stay editable, so uniqueness is checked on every write: the same slug may exist once
 * per scope, and the tracker and the rollups key on it. The compound index backs this up
 * where it can, but it cannot cover install-wide rows on Postgres or a host-owned scope field.
 */
const uniqueSlug = (args: BuildGoalsCollectionArgs): CollectionBeforeValidateHook => {
	return async ({ data, originalDoc, req }) => {
		const slug = data?.slug
		if (typeof slug !== 'string' || slug === '') {
			return data
		}
		const where: Where[] = [{ slug: { equals: slug } }]
		if (args.scoped) {
			where.push(
				goalScopeWhere(args.scopeField, await writeScope(args, { data, originalDoc, req }))
			)
		}
		const id = originalDoc?.id
		if (id !== undefined && id !== null) {
			where.push({ id: { not_equals: id } })
		}
		// pagination:false is load-bearing: a paginated read fires its count and its find in
		// parallel on one Mongo session, which the write's open transaction refuses.
		const { docs } = await req.payload.find({
			collection: args.slug as never,
			where: { and: where },
			limit: 1,
			pagination: false,
			depth: 0,
			overrideAccess: true,
			req,
		})
		if (docs.length > 0) {
			throw new ValidationError({
				collection: args.slug,
				errors: [
					{
						label: labelForKey(keys.goalFieldSlug),
						message: asTranslate(req.t)(keys.goalErrorSlugTaken),
						path: 'slug',
					},
				],
			})
		}
		return data
	}
}

/**
 * Database-level backstop for the hook, and only where the plugin owns the scope field: a
 * host-owned one (a tenant plugin's relationship) is not ours to index. Postgres treats a
 * NULL scope as distinct from every other, so install-wide rows stay hook-guarded.
 */
const uniqueSlugIndex = (args: BuildGoalsCollectionArgs): CompoundIndex | undefined => {
	if (!args.scoped) {
		return { fields: ['slug'], unique: true }
	}
	return args.scopeField === 'scope' ? { fields: ['slug', 'scope'], unique: true } : undefined
}

/**
 * The plugin's own scope field, and only when `scopeField` still names it: a host-owned
 * field (a tenant plugin's relationship) is the host's to register, and shadowing it with a
 * hidden text field of another name would store the scope twice.
 */
const scopeField = (args: BuildGoalsCollectionArgs): Field[] =>
	args.scopeField === 'scope'
		? [
				{
					// Written by scoped setups; hidden because single-site installs never touch it.
					name: 'scope',
					type: 'text',
					index: true,
					label: labelForKey(keys.providerFieldScope),
					admin: { hidden: true },
				},
			]
		: []

const matchField = (): Field => ({
	name: 'match',
	type: 'group',
	label: labelForKey(keys.goalFieldMatch),
	fields: [
		{
			name: 'kind',
			type: 'select',
			required: true,
			defaultValue: 'goal',
			label: labelForKey(keys.goalFieldMatchKind),
			options: [
				{ label: labelForKey(keys.goalKindGoal), value: 'goal' },
				{ label: labelForKey(keys.goalKindEvent), value: 'event' },
				{ label: labelForKey(keys.goalKindPath), value: 'path' },
			],
		},
		{
			name: 'name',
			type: 'text',
			label: labelForKey(keys.goalFieldMatchEventName),
			admin: { condition: (_data, siblingData) => siblingData?.kind === 'event' },
		},
		{
			name: 'pattern',
			type: 'text',
			label: labelForKey(keys.goalFieldMatchPathPattern),
			admin: {
				condition: (_data, siblingData) => siblingData?.kind === 'path',
				description: labelForKey(keys.goalFieldMatchPathPatternHelp),
			},
		},
	],
})

const valueField = (): Field => ({
	name: 'value',
	type: 'group',
	label: labelForKey(keys.goalFieldValue),
	fields: [
		{
			type: 'row',
			fields: [
				{
					name: 'fixed',
					type: 'number',
					min: 0,
					label: labelForKey(keys.goalFieldValueFixed),
					admin: { width: '50%' },
				},
				{
					name: 'prop',
					type: 'text',
					label: labelForKey(keys.goalFieldValueProp),
					admin: {
						width: '50%',
						description: labelForKey(keys.goalFieldValuePropHelp),
					},
				},
			],
		},
	],
})

/**
 * The editor-managed goals collection: one document per goal (and per scope in scoped
 * installs), merged over the config goals by the resolver. Admin-only by default; `access`
 * entries override individual operations and `overrides` reshapes the whole config last,
 * so slugs, labels, fields, and access all stay overridable.
 */
export const buildGoalsCollection = (args: BuildGoalsCollectionArgs): CollectionConfig => {
	const unique = uniqueSlugIndex(args)
	const collection: CollectionConfig = {
		slug: args.slug,
		...(unique ? { indexes: [unique] } : {}),
		labels: {
			singular: labelForKey(keys.goalsCollectionSingular),
			plural: labelForKey(keys.goalsCollectionPlural),
		},
		// A duplicate would carry the slug over, which the uniqueness hook refuses anyway.
		disableDuplicate: true,
		admin: {
			useAsTitle: 'name',
			defaultColumns: ['name', 'slug', 'match.kind', 'enabled'],
			group: 'Analytics',
		},
		access: {
			read: providerRowAccess(args),
			create: providerCreateAccess(args),
			update: providerRowAccess(args),
			delete: providerRowAccess(args),
			...args.access,
		},
		hooks: {
			beforeValidate: [uniqueSlug(args)],
			beforeChange: [stampScope(args)],
			afterChange: [
				({ doc }) => {
					args.onChange()
					return doc
				},
			],
			afterDelete: [
				({ doc }) => {
					args.onChange()
					return doc
				},
			],
		},
		fields: [
			{
				name: 'name',
				type: 'text',
				required: true,
				label: labelForKey(keys.goalFieldName),
			},
			{
				type: 'row',
				fields: [
					{
						name: 'slug',
						type: 'text',
						required: true,
						// Mongoose refuses a field index and a compound index that share a key
						// spec, and the compound one already covers a lookup by slug.
						index: unique === undefined,
						label: labelForKey(keys.goalFieldSlug),
						validate: validateSlug,
						admin: {
							width: '50%',
							description: labelForKey(keys.goalFieldSlugHelp),
						},
					},
					{
						name: 'enabled',
						type: 'checkbox',
						defaultValue: true,
						label: labelForKey(keys.goalFieldEnabled),
						admin: { width: '50%', style: { alignSelf: 'flex-end' } },
					},
				],
			},
			matchField(),
			valueField(),
			{
				name: 'currency',
				type: 'text',
				label: labelForKey(keys.goalFieldCurrency),
				validate: validateCurrency,
			},
			...scopeField(args),
		],
	}
	return args.overrides ? args.overrides(collection) : collection
}
