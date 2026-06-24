import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'

/** Which submission statuses to count. `complete` (default) excludes partials; `all` counts everything. */
export type SubmissionStatusFilter = 'complete' | 'partial' | 'all'

/** One answer option (or distinct value) with its tally. */
export type AggregationBucket = {
	/** The answer value, stringified (the grouping key). */
	value: string
	/** Display label: current option label, else the submitted snapshot label, else the raw value. */
	label: string
	count: number
	/** Share of respondents, 0-100, rounded to one decimal. Can sum past 100 for multi-value fields. */
	percentage: number
}

/** Aggregated responses for one field across a form's submissions. */
export type FieldAggregation = {
	field: string
	label?: string
	fieldType?: string
	/** Respondents: submissions with a non-empty answer for this field. The percentage denominator. */
	total: number
	buckets: AggregationBucket[]
	/** True when the `maxSubmissions` cap was hit, so the tallies are a (large) sample, not the full set. */
	truncated: boolean
}

/** The slice of a submission the reducer reads. */
export type AggregationRow = {
	values?: SubmissionValue[]
	descriptors?: SubmissionDescriptor[]
}

/** Field metadata the reducer needs to label and order buckets, derived from the live form definition. */
export type FieldMeta = {
	field: string
	label?: string
	fieldType?: string
	/** Ordered known options with current labels; drives bucket order and label resolution. */
	options?: { value: string; label: string }[]
}
