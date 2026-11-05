import { pickLabel } from '../translations/labelMap'
import type { AdapterLabelArgs, AnalyticsAdapter } from './contract'
import type { SourceRef } from './sourcePolicy'
import { isRecord, kindOf } from './values'

/**
 * A built-in adapter's `label` option: one name, a name per admin language (read like
 * `view.navLabel`), or a function naming the source for each reader.
 */
export type AdapterLabelOption =
	| string
	| Record<string, string>
	| ((args: AdapterLabelArgs) => string | Promise<string>)

type LabelFields = Pick<AnalyticsAdapter, 'label' | 'labelFor'>

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

const isLabelMap = (value: unknown): value is Record<string, string> =>
	isRecord(value) &&
	!Array.isArray(value) &&
	Object.values(value).every((text) => typeof text === 'string')

/**
 * The label fields a factory spreads into its adapter: `label` for surfaces with no reader (the
 * string, else the map's `en` or first entry, else `vendor`) and `labelFor` per reader. A blank
 * string counts as unset, as `view.navLabel` reads one.
 */
export const adapterLabel = (
	option: AdapterLabelOption | undefined,
	vendor: string,
	owner: string
): LabelFields => {
	if (option === undefined) {
		return { label: vendor }
	}
	if (typeof option === 'string') {
		return { label: filled(option) ? option : vendor }
	}
	if (typeof option === 'function') {
		return { label: vendor, labelFor: option }
	}
	if (isLabelMap(option)) {
		const label = pickLabel(option, 'en') ?? Object.values(option).find(filled) ?? vendor
		return {
			label,
			labelFor: ({ req }) =>
				pickLabel(option, req.i18n?.language, req.i18n?.fallbackLanguage) ?? label,
		}
	}
	throw new Error(
		`analytics: ${owner} must be a label, a map of labels by language such as { en: 'Traffic' }, or a label function, got ${kindOf(option)}`
	)
}

/**
 * A source's name for one reader. A `labelFor` that throws or names nothing reads as `label`, with
 * a warning, so one host function cannot blank a listing.
 */
export const sourceLabelFor = async (
	adapter: Pick<AnalyticsAdapter, 'id' | 'label' | 'labelFor'>,
	args: AdapterLabelArgs
): Promise<string> => {
	if (!adapter.labelFor) {
		return adapter.label
	}
	try {
		const label: unknown = await adapter.labelFor(args)
		if (filled(label)) {
			return label
		}
		args.req.payload.logger?.warn(
			`analytics: label of source "${adapter.id}" named ${kindOf(label)}, using "${adapter.label}"`
		)
	} catch (err) {
		args.req.payload.logger?.warn(
			`analytics: label of source "${adapter.id}" failed, using "${adapter.label}": ${String(err)}`
		)
	}
	return adapter.label
}

/** A source as this reader is shown it; `configIds` tells an adapter every scope shares. */
export const sourceRefFor = async (
	adapter: AnalyticsAdapter,
	args: AdapterLabelArgs & { configIds: ReadonlySet<string>; docId?: string }
): Promise<SourceRef> => ({
	id: adapter.id,
	label: await sourceLabelFor(adapter, args),
	kind: args.configIds.has(adapter.id) ? 'config' : 'runtime',
	...(args.docId === undefined ? {} : { docId: args.docId }),
})

/**
 * The adapter under one fixed name for every reader, as a provider document names its source:
 * a `labelFor` it carried would otherwise rename it per request.
 */
export const withFixedLabel = (adapter: AnalyticsAdapter, label: string): AnalyticsAdapter => {
	const { labelFor: _perReader, ...fixed } = adapter
	return { ...fixed, label }
}
