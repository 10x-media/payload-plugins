import type { FieldTypes, LabelFunction, StaticLabel } from 'payload'

/**
 * How two values of one field combine.
 *
 * - `nonEmpty`: the side with a value wins; two different values are a conflict the
 *   reviewer sees, proposed as the survivor's.
 * - `union`: lists are concatenated without duplicates; scalars behave like `nonEmpty`.
 * - `manual`: like `nonEmpty`, but a conflict blocks the merge until a choice is made.
 * - `survivor`: the survivor's value, shown read-only.
 * - `skip`: left out of the plan entirely.
 */
export type MergePolicy = 'manual' | 'nonEmpty' | 'skip' | 'survivor' | 'union'

export type MergeFieldSpec = {
	/** Dot path from the document root; array and blocks fields are leaves. */
	path: string
	label: false | LabelFunction | StaticLabel | undefined
	type: FieldTypes
	policy: MergePolicy
	/** The value at `path` is keyed by locale when the document is read with `locale: 'all'`. */
	localized: boolean
	/** `hasMany` relationships, uploads, selects, texts and numbers, plus arrays and blocks. */
	list: boolean
	/** Hidden from the admin; merged but never shown. */
	hidden: boolean
	unique: boolean
	required: boolean
	relationTo?: string | string[]
	/**
	 * Drawn by a `Field` component of its own, which the merge screen shows. A group or list of
	 * one is merged whole, unless it declares `split`.
	 */
	component: boolean
}

/** A field of the spec as one reviewer merges it. */
export type ReviewedFieldSpec = MergeFieldSpec & {
	/** The reviewer may not change the field, so the merge leaves even its pointers as they are. */
	locked?: boolean
	/** The reviewer may not read the field on the survivor; it is `hidden` too. */
	unread?: boolean
	/** Its own `read` hides a value of a merged-in document: no value comes from another one. */
	sealed?: boolean
}

/**
 * The reviewer's answer for a field: one document's value, or for a list the items they
 * checked, each by its document and its place in that document's list.
 */
export type MergeChoice = { doc: string } | { items: { doc: string; index: number }[] }

/** Where a decision's value comes from: a document of the group by id, or one of these. */
export type DecisionSource = 'same' | 'union' | (string & {})

/** One document's value of a field. */
export type DocValue = { doc: string; value: unknown }

export type MergeDecision = {
	/** `path`, or `path@locale` for a localized field. Choices are keyed by this. */
	key: string
	path: string
	locale?: string
	type: FieldTypes
	policy: MergePolicy
	/**
	 * Hidden from the admin, or not readable by the reviewer on the survivor: decided by the
	 * policy, never sent to the screen.
	 */
	hidden: boolean
	list: boolean
	/** An empty value is never picked for it. */
	required: boolean
	relationTo?: string | string[]
	/** Drawn by a `Field` component of its own, which the merge screen shows. */
	component: boolean
	/** Every document's value, the survivor's first. */
	values: DocValue[]
	proposed: unknown
	source: DecisionSource
	/** Taken from another document because the survivor's is empty. */
	auto: boolean
	/** Two documents or more hold different, non-empty values. */
	conflict: boolean
	/** A `manual` conflict without a choice. */
	requiresChoice: boolean
	/** The survivor's value changes when the merge is applied. */
	changed: boolean
}

export type MergePlan = {
	decisions: MergeDecision[]
	readyToApply: boolean
	/** Non-localized field values to write. */
	base: Record<string, unknown>
	/** Localized field values to write, one map per locale. */
	byLocale: Record<string, Record<string, unknown>>
	/** Decision keys whose result loses pointers at documents of the merge itself. */
	cleared: string[]
	/**
	 * What Payload requires in a language the merge writes and the result leaves empty there:
	 * `none` when no document of the merge has it, `kept` when the merge may not take it from
	 * one, `rows` for a value inside rows or a localized group; `path` names the field.
	 */
	missing: { path: string; locale: string; reason: 'kept' | 'none' | 'rows' }[]
	/** Keys of decisions whose required value came from the most similar document. */
	filled: string[]
	/**
	 * Locales written as a draft, then published with the write locale: every value Payload
	 * requires there and the result leaves empty, the survivor lacked before the merge.
	 */
	drafted: string[]
}
