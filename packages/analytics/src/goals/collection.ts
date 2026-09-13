import type {
	CollectionBeforeValidateHook,
	CollectionConfig,
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

const CURRENCY_PATTERN = /^[A-Z]{3}$/

const validateSlug: TextFieldSingleValidation = (value, { req }) =>
	typeof value === 'string' && GOAL_SLUG_PATTERN.test(value)
		? true
		: asTranslate(req.t)(keys.goalErrorSlug)

const validateCurrency: TextFieldSingleValidation = (value, { req }) =>
	!value || CURRENCY_PATTERN.test(value) ? true : asTranslate(req.t)(keys.goalErrorCurrency)

const asScope = (value: unknown): string | null =>
	value === null || value === undefined || value === '' ? null : String(value)

/**
 * The scope the write lands in: what the body carries (a platform admin writing another
 * tenant's goal), else the stored one, else the requester's own. A forged body scope is
 * still refused by stampScope, so the lookup can trust it to name the right neighbourhood.
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
	const declared = asScope(data?.[args.scopeField]) ?? asScope(originalDoc?.[args.scopeField])
	if (declared !== null) {
		return declared
	}
	try {
		return asScope(await args.resolveScope(req))
	} catch {
		return null
	}
}

/**
 * Slugs stay editable, so uniqueness is checked on every write rather than pinned by a
 * database index: the same slug may exist once per scope, and the tracker and the rollups
 * key on it.
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
	const collection: CollectionConfig = {
		slug: args.slug,
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
						index: true,
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
			{
				// Written by scoped setups (or a tenant plugin's own field via `scopeField`);
				// hidden because single-site installs never touch it.
				name: 'scope',
				type: 'text',
				index: true,
				label: labelForKey(keys.providerFieldScope),
				admin: { hidden: true },
			},
		],
	}
	return args.overrides ? args.overrides(collection) : collection
}
