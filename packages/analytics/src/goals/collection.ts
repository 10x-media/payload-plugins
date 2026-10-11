import type {
	CollectionBeforeValidateHook,
	CollectionConfig,
	CollectionSlug,
	CompoundIndex,
	Field,
	PayloadRequest,
	TextFieldSingleValidation,
	Where,
} from 'payload'
import { ValidationError } from 'payload'
import { valueAt } from '../core/values'
import {
	type CollectionFieldOverride,
	hasNamedField,
	overrideField,
	pairInRow,
} from '../plugin/collectionFields'
import { docScope, type ScopeChange } from '../plugin/scopeChange'
import type { ProviderAccessArgs } from '../providers/access'
import { memberScopeOf, providerCreateAccess, providerRowAccess } from '../providers/access'
import { stampScope } from '../providers/stampScope'
import { keys, type TranslationKey } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { builtInStaticLabel, type StaticLabelFor } from '../translations/staticLabel'
import { amountField } from './amountField'
import { type AmountOf, amountCurrencyField } from './currency'
import { hiddenAdmin } from './moneyFields'
import { MAX_PATTERN_GLOBSTARS, MAX_PATTERN_SEGMENTS, patternProblem } from './pathMatch'
import { goalScopeWhere } from './resolver'
import { GOAL_SLUG_PATTERN } from './types'

export const GOALS_SLUG = 'analytics-goals'

/**
 * Replaces one default field, receiving the plugin's own to spread. Any field type may come back, a
 * `row` included, as long as the slug override still holds a field named `slug`.
 */
export type GoalFieldOverride = CollectionFieldOverride

export interface GoalCollectionFieldOverrides {
	name?: GoalFieldOverride
	slug?: GoalFieldOverride
	enabled?: GoalFieldOverride
	browser?: GoalFieldOverride
	match?: GoalFieldOverride
	value?: GoalFieldOverride
	currency?: GoalFieldOverride
}

export interface BuildGoalsCollectionArgs extends ProviderAccessArgs {
	slug: string
	access?: Partial<CollectionConfig['access']>
	/** Per-field overrides, applied before the whole-collection `overrides`. */
	fields?: GoalCollectionFieldOverrides
	overrides?: (collection: CollectionConfig) => CollectionConfig
	/**
	 * Whether the install measures money, default on. False hides the amount and currency rather than
	 * removing them, so existing amounts survive and show again when it is turned back on.
	 */
	revenue?: boolean
	/**
	 * The install's reporting currency when it is one fixed code. The Amount control fills it
	 * in once an amount is set on a goal that has no currency yet.
	 */
	defaultCurrency?: string
	/**
	 * Called after any change or delete with the scopes the write touched and the request that
	 * wrote, so that request's own Payload instance reads those scopes again once the write commits.
	 */
	onChange: (change: ScopeChange, req: PayloadRequest) => void | Promise<void>
	/** The install's static labels; the built-in strings alone when absent. */
	staticLabel?: StaticLabelFor
}

const validateSlug: TextFieldSingleValidation = (value, { req }) =>
	typeof value === 'string' && GOAL_SLUG_PATTERN.test(value)
		? true
		: asTranslate(req.t)(keys.goalErrorSlug)

/** The matcher's caps, refused here so an editor hears about them rather than a goal never matching. */
const validatePattern: TextFieldSingleValidation = (value, { req }) =>
	typeof value === 'string' && patternProblem(value) !== null
		? asTranslate(req.t)(keys.goalErrorPatternLimits, {
				segments: MAX_PATTERN_SEGMENTS,
				globstars: MAX_PATTERN_GLOBSTARS,
			})
		: true

const asScope = (value: unknown): string | null =>
	value === null || value === undefined || value === '' ? null : String(value)

/**
 * The scope the stamp will land the write in. Only a platform admin's declared scope is trusted:
 * anyone else's would turn "slug taken" into an oracle for what another tenant owns.
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
		if (await args.crossScope({ req })) {
			// No declared scope means an install-wide goal, not one in whatever scope the
			// admin's own request happens to resolve to.
			return asScope(data?.[args.scopeField]) ?? asScope(originalDoc?.[args.scopeField])
		}
		return await memberScopeOf(args, req)
	} catch {
		return null
	}
}

const slugError = (collection: string, req: PayloadRequest, key: TranslationKey) =>
	new ValidationError({
		collection,
		errors: [
			{
				label: labelForKey(keys.goalFieldSlug),
				message: asTranslate(req.t)(key),
				path: 'slug',
			},
		],
	})

/**
 * Slug shape and per-scope uniqueness at collection level, so a replaced slug field without its own
 * `validate` keeps them; the index cannot cover install-wide Postgres rows or host scope fields.
 */
const checkSlug = (args: BuildGoalsCollectionArgs): CollectionBeforeValidateHook => {
	return async ({ data, originalDoc, req }) => {
		const slug = data?.slug
		if (typeof slug !== 'string' || slug === '') {
			return data
		}
		if (!GOAL_SLUG_PATTERN.test(slug)) {
			throw slugError(args.slug, req, keys.goalErrorSlug)
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
			// This hook runs on the collection itself, so its slug is registered.
			collection: args.slug as CollectionSlug,
			where: { and: where },
			limit: 1,
			pagination: false,
			depth: 0,
			overrideAccess: true,
			req,
		})
		if (docs.length > 0) {
			throw slugError(args.slug, req, keys.goalErrorSlugTaken)
		}
		return data
	}
}

/**
 * Database backstop for the hook, only where the plugin owns the scope field. Postgres treats a NULL
 * scope as distinct, so install-wide rows stay hook-guarded.
 */
const uniqueSlugIndex = (args: BuildGoalsCollectionArgs): CompoundIndex | undefined => {
	if (!args.scoped) {
		return { fields: ['slug'], unique: true }
	}
	return args.scopeField === 'scope' ? { fields: ['slug', 'scope'], unique: true } : undefined
}

/**
 * The plugin's scope field, only while `scopeField` names it: a host-owned field is the host's to
 * register, and a hidden twin would store the scope twice.
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

const nameField = (): Field => ({
	name: 'name',
	type: 'text',
	required: true,
	label: labelForKey(keys.goalFieldName),
	admin: { width: '50%', description: labelForKey(keys.goalFieldNameHelp) },
})

const slugField = (indexed: boolean): Field => ({
	name: 'slug',
	type: 'text',
	required: true,
	// Mongoose refuses a field index and a compound index that share a key spec, and the
	// compound one already covers a lookup by slug.
	index: indexed,
	label: labelForKey(keys.goalFieldSlug),
	validate: validateSlug,
	admin: { width: '50%', description: labelForKey(keys.goalFieldSlugHelp) },
})

const enabledField = (): Field => ({
	name: 'enabled',
	type: 'checkbox',
	defaultValue: true,
	label: labelForKey(keys.goalFieldEnabled),
	admin: { position: 'sidebar', description: labelForKey(keys.goalFieldEnabledHelp) },
})

/** Off for a goal only server code completes: a browser's completion of it is then ignored. */
const browserField = (): Field => ({
	name: 'browser',
	type: 'checkbox',
	defaultValue: true,
	label: labelForKey(keys.goalFieldBrowser),
	admin: { position: 'sidebar', description: labelForKey(keys.goalFieldBrowserHelp) },
})

const matchField = (staticLabel: StaticLabelFor): Field => ({
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
			// `admin.description` on a select is read where a label function never runs, so the
			// three kinds are explained through the locale map instead.
			admin: { description: staticLabel(keys.goalFieldMatchKindHelp) },
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
			admin: {
				condition: (_data, siblingData) => siblingData?.kind === 'event',
				description: labelForKey(keys.goalFieldMatchEventNameHelp),
			},
		},
		{
			name: 'pattern',
			type: 'text',
			label: labelForKey(keys.goalFieldMatchPathPattern),
			validate: validatePattern,
			admin: {
				condition: (_data, siblingData) => siblingData?.kind === 'path',
				description: labelForKey(keys.goalFieldMatchPathPatternHelp),
			},
		},
	],
})

/**
 * The amount and where else it may come from, with no heading of their own so they read as
 * part of the goal. The currency is the sibling `currency` field, edited in the Amount control.
 */
const valueField = (defaultCurrency: string | undefined): Field => ({
	name: 'value',
	type: 'group',
	label: false,
	admin: { hideGutter: true },
	fields: [
		amountField(
			{
				name: 'fixed',
				type: 'number',
				min: 0,
				label: labelForKey(keys.goalFieldAmount),
				admin: { description: labelForKey(keys.goalFieldAmountHelp) },
			},
			{ currencyPath: '../currency', defaultCurrency }
		),
		{
			name: 'prop',
			type: 'text',
			label: labelForKey(keys.goalFieldAmountProp),
			admin: {
				description: labelForKey(keys.goalFieldAmountPropHelp),
				// Only an action's own details can carry an amount to read.
				condition: (data) => data?.match?.kind === 'event',
			},
		},
	],
})

/** The amount a goal's currency belongs to: its fixed amount. */
const fixedAmount: AmountOf = ({ data }) => valueAt(data, 'value.fixed')

/**
 * Hidden rather than removed while the install measures no money, a replacement included: the
 * field stays in the schema, so a goal that already carries an amount keeps it.
 */
const moneyOnly = (field: Field, revenue: boolean | undefined): Field =>
	revenue === false ? Object.assign({}, field, { admin: hiddenAdmin(field) }) : field

/**
 * Name and slug share the first row while both are plain named fields; a layout or sidebar
 * replacement cannot live in a row, so it goes top level at its declared position.
 */
const layout = (args: BuildGoalsCollectionArgs, indexed: boolean): Field[] => [
	...pairInRow(
		overrideField(nameField(), args.fields?.name),
		overrideField(slugField(indexed), args.fields?.slug)
	),
	overrideField(enabledField(), args.fields?.enabled),
	overrideField(browserField(), args.fields?.browser),
	overrideField(matchField(args.staticLabel ?? builtInStaticLabel), args.fields?.match),
	moneyOnly(overrideField(valueField(args.defaultCurrency), args.fields?.value), args.revenue),
	moneyOnly(overrideField(amountCurrencyField(fixedAmount), args.fields?.currency), args.revenue),
	...scopeField(args),
]

/**
 * The editor-managed goals collection, one document per goal and scope, merged over config goals.
 * Admin-only by default; `access`, `fields` and finally `overrides` reshape it.
 */
export const buildGoalsCollection = (args: BuildGoalsCollectionArgs): CollectionConfig => {
	const unique = uniqueSlugIndex(args)
	const fields = layout(args, unique === undefined)
	if (!hasNamedField(fields, 'slug')) {
		throw new Error(
			`analytics: goals.collection.fields.slug must return a field named "slug" (a row or group containing one is fine); the goals collection "${args.slug}" keys every report on that value`
		)
	}
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
			group: (args.staticLabel ?? builtInStaticLabel)(keys.adminGroup),
		},
		access: {
			read: providerRowAccess(args),
			create: providerCreateAccess(args),
			update: providerRowAccess(args),
			delete: providerRowAccess(args),
			...args.access,
		},
		hooks: {
			beforeValidate: [checkSlug(args)],
			beforeChange: [stampScope(args)],
			afterChange: [
				async ({ doc, operation, previousDoc, req }) => {
					await args.onChange(
						{
							scope: docScope(doc, args.scopeField),
							...(operation === 'update'
								? { previousScope: docScope(previousDoc, args.scopeField) }
								: {}),
						},
						req
					)
					return doc
				},
			],
			afterDelete: [
				async ({ doc, req }) => {
					await args.onChange({ scope: docScope(doc, args.scopeField) }, req)
					return doc
				},
			],
		},
		fields,
	}
	return args.overrides ? args.overrides(collection) : collection
}
