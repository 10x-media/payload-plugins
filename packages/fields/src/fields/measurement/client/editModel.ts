import { roundTo } from '../engine/convert'
import { DIMENSION_LOCALE_DEFAULTS, type MeasurementSystem } from '../engine/locale'
import type { MeasurementEngine } from '../engine/registry'
import { COMPOUNDS, type MeasurementUnitId, STORAGE_FRACTION_DIGITS } from '../engine/units'

/** Widened for lookup by any field dimension, including custom dimensions the table has no entry for. */
const dimensionLocaleDefaults: Partial<
	Record<string, Record<MeasurementSystem, MeasurementUnitId>>
> = DIMENSION_LOCALE_DEFAULTS

/** Locale step of the resolution chain: field-declared defaults first, then the per-dimension table. */
const localeCandidatesFor = (args: {
	dimension: string
	system: MeasurementSystem
	localeDefaults?: Partial<Record<MeasurementSystem, MeasurementUnitId>>
}): MeasurementUnitId[] =>
	[
		args.localeDefaults?.[args.system],
		dimensionLocaleDefaults[args.dimension]?.[args.system],
	].filter((unit): unit is MeasurementUnitId => typeof unit === 'string')

export type MeasurementDrafts = { primary: string; minor: string }

type UnitContext = {
	/** Bound over the field's custom units, so custom ids convert and format like built-ins. */
	engine: MeasurementEngine
	storageUnit: MeasurementUnitId
	displayUnit: MeasurementUnitId
	precision?: Partial<Record<MeasurementUnitId, number>>
}

const numberToDraft = (value: number): string => String(value)

const parseDraft = (raw: string): number | null => {
	if (raw.trim() === '') return null
	const parsed = Number(raw)
	return Number.isFinite(parsed) ? parsed : null
}

export const commitDrafts = (
	drafts: MeasurementDrafts,
	opts: Pick<UnitContext, 'displayUnit' | 'engine' | 'storageUnit'>
): number | null => {
	const { displayUnit, engine, storageUnit } = opts
	const primary = parseDraft(drafts.primary)
	if (primary === null) return null
	if (engine.isCompoundUnit(displayUnit)) {
		const rawMinor = parseDraft(drafts.minor) ?? 0
		const maxMinor = COMPOUNDS[displayUnit].ratio - 0.001
		// Clamp the magnitude only: decompose is sign-safe and negative drafts
		// carry the sign on both parts, so zeroing a negative minor would corrupt
		// the round-trip.
		const minor = Math.sign(rawMinor) * Math.min(Math.abs(rawMinor), maxMinor)
		return roundTo(
			engine.compose({ major: primary, minor }, displayUnit, storageUnit),
			STORAGE_FRACTION_DIGITS
		)
	}
	return roundTo(engine.convert(primary, displayUnit, storageUnit), STORAGE_FRACTION_DIGITS)
}

/**
 * Shortest drafts that commit back to the stored value: display precision first,
 * then one more fraction digit at a time up to storage precision. An editable
 * draft that silently truncates the stored value would write the truncation back
 * on the next save, so faithfulness outranks prettiness.
 */
export const draftsFor = (value: number | null, opts: UnitContext): MeasurementDrafts => {
	if (typeof value !== 'number' || Number.isNaN(value)) return { minor: '', primary: '' }
	const { displayUnit, engine, precision, storageUnit } = opts
	const draftAt = (digits: number): MeasurementDrafts => {
		if (engine.isCompoundUnit(displayUnit)) {
			const parts = engine.decompose(value, storageUnit, displayUnit, digits)
			return { minor: numberToDraft(parts.minor), primary: numberToDraft(parts.major) }
		}
		const converted = roundTo(engine.convert(value, storageUnit, displayUnit), digits)
		return { minor: '', primary: numberToDraft(converted) }
	}

	// Digits past storage precision never survive a save, so that is where escalation stops.
	const displayDigits = engine.precisionFor(displayUnit, precision)
	const maxDigits = Math.max(displayDigits, STORAGE_FRACTION_DIGITS)
	const target = roundTo(value, STORAGE_FRACTION_DIGITS)
	for (let digits = displayDigits; digits < maxDigits; digits++) {
		const candidate = draftAt(digits)
		if (commitDrafts(candidate, opts) === target) return candidate
	}
	return draftAt(maxDigits)
}

/** First candidate the field actually offers wins; the field's first unit is the floor. */
export const resolveDisplayUnit = (args: {
	dimension: string
	preferenceUnit?: MeasurementUnitId | null
	fallbackUnit?: MeasurementUnitId
	registryDefault?: MeasurementUnitId
	/** Null until the browser locale is read post-hydration, which skips both locale steps. */
	system?: MeasurementSystem | null
	localeDefaults?: Partial<Record<MeasurementSystem, MeasurementUnitId>>
	units: readonly MeasurementUnitId[]
}): MeasurementUnitId => {
	const localeCandidates = args.system
		? localeCandidatesFor({
				dimension: args.dimension,
				localeDefaults: args.localeDefaults,
				system: args.system,
			})
		: []
	const candidates = [
		args.preferenceUnit,
		args.fallbackUnit,
		args.registryDefault,
		...localeCandidates,
	]
	for (const candidate of candidates) {
		if (candidate && args.units.includes(candidate)) return candidate
	}
	const first = args.units[0]
	if (!first) throw new Error('resolveDisplayUnit: empty units list')
	return first
}
