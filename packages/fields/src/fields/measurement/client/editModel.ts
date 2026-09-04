import { convert, roundTo } from '../engine/convert'
import { compose, decompose } from '../engine/format'
import {
	COMPOUNDS,
	isCompoundUnit,
	precisionFor,
	type ScalarUnitId,
	STORAGE_FRACTION_DIGITS,
	type UnitId,
} from '../engine/units'

export type MeasurementDrafts = { primary: string; minor: string }

type UnitContext = {
	storageUnit: ScalarUnitId
	displayUnit: UnitId
	precision?: Partial<Record<UnitId, number>>
}

const numberToDraft = (value: number): string => String(value)

export const draftsFor = (value: number | null, opts: UnitContext): MeasurementDrafts => {
	if (typeof value !== 'number' || Number.isNaN(value)) return { minor: '', primary: '' }
	if (isCompoundUnit(opts.displayUnit)) {
		const parts = decompose(
			value,
			opts.storageUnit,
			opts.displayUnit,
			precisionFor(opts.displayUnit, opts.precision)
		)
		return { minor: numberToDraft(parts.minor), primary: numberToDraft(parts.major) }
	}
	const digits = precisionFor(opts.displayUnit, opts.precision)
	return {
		minor: '',
		primary: numberToDraft(roundTo(convert(value, opts.storageUnit, opts.displayUnit), digits)),
	}
}

const parseDraft = (raw: string): number | null => {
	if (raw.trim() === '') return null
	const parsed = Number(raw)
	return Number.isFinite(parsed) ? parsed : null
}

export const commitDrafts = (
	drafts: MeasurementDrafts,
	opts: Pick<UnitContext, 'displayUnit' | 'storageUnit'>
): number | null => {
	const primary = parseDraft(drafts.primary)
	if (primary === null) return null
	if (isCompoundUnit(opts.displayUnit)) {
		const rawMinor = parseDraft(drafts.minor) ?? 0
		const maxMinor = COMPOUNDS[opts.displayUnit].ratio - 0.001
		// Clamp the magnitude only: decompose is sign-safe and negative drafts
		// carry the sign on both parts, so zeroing a negative minor would corrupt
		// the round-trip.
		const minor = Math.sign(rawMinor) * Math.min(Math.abs(rawMinor), maxMinor)
		return roundTo(
			compose({ major: primary, minor }, opts.displayUnit, opts.storageUnit),
			STORAGE_FRACTION_DIGITS
		)
	}
	return roundTo(convert(primary, opts.displayUnit, opts.storageUnit), STORAGE_FRACTION_DIGITS)
}

/** First candidate the field actually offers wins; the field's first unit is the floor. */
export const resolveDisplayUnit = (args: {
	preferenceUnit?: UnitId | null
	defaultUnit?: UnitId
	registryDefault?: UnitId
	localeUnit?: UnitId | null
	units: readonly UnitId[]
}): UnitId => {
	const candidates = [args.preferenceUnit, args.defaultUnit, args.registryDefault, args.localeUnit]
	for (const candidate of candidates) {
		if (candidate && args.units.includes(candidate)) return candidate
	}
	const first = args.units[0]
	if (!first) throw new Error('resolveDisplayUnit: empty units list')
	return first
}
