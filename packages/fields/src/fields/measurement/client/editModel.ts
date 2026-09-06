import { roundTo } from '../engine/convert'
import type { MeasurementEngine } from '../engine/registry'
import { COMPOUNDS, type MeasurementUnitId, STORAGE_FRACTION_DIGITS } from '../engine/units'

/** Re-exported so MeasurementField/MeasurementCell keep one import site for the edit model. */
export { resolveDisplayUnit } from '../engine/locale'

export type MeasurementDrafts = { primary: string; minor: string }

/** Which inputs the viewer has actually typed into since the last resync. */
export type DirtyDrafts = { primary: boolean; minor: boolean }

type UnitContext = {
	/** Bound over the field's custom units, so custom ids convert and format like built-ins. */
	engine: MeasurementEngine
	storageUnit: MeasurementUnitId
	displayUnit: MeasurementUnitId
	precision?: Partial<Record<MeasurementUnitId, number>>
	/**
	 * Draft-repaint policy: 'faithful' (default) escalates fraction digits until the
	 * draft round-trips to the stored value; 'display' renders straight at display
	 * digits, so a stored value can print shorter than it is stored.
	 */
	draft?: 'display' | 'faithful'
	/** Fraction digits kept in the storage unit. Defaults to STORAGE_FRACTION_DIGITS. */
	storageDigits?: number
}

type CommitOptions = UnitContext & {
	/**
	 * Entry-unit typing behavior: 'quantize' rounds a dirty part at its own display
	 * digits, in the unit it was typed in, before converting; 'free' (default) keeps
	 * the typed value exact.
	 */
	entry?: 'quantize' | 'free'
	/** An untouched part never commits its displayed string; only a dirty one does. */
	dirty?: DirtyDrafts
	/** Current stored value, used to derive an untouched part's exact contribution. */
	storedValue?: number | null
}

const numberToDraft = (value: number): string => String(value)

const parseDraft = (raw: string): number | null => {
	if (raw.trim() === '') return null
	const parsed = Number(raw)
	return Number.isFinite(parsed) ? parsed : null
}

const ALL_DIRTY: DirtyDrafts = { primary: true, minor: true }

export const commitDrafts = (drafts: MeasurementDrafts, opts: CommitOptions): number | null => {
	const {
		displayUnit,
		dirty = ALL_DIRTY,
		engine,
		entry = 'free',
		precision,
		storageDigits = STORAGE_FRACTION_DIGITS,
		storageUnit,
		storedValue = null,
	} = opts

	if (engine.isCompoundUnit(displayUnit)) {
		const compound = COMPOUNDS[displayUnit]
		// An untouched part contributes the value stored today, decomposed at storage
		// precision, never the last-displayed draft string: that string can lag the
		// stored value under 'display' draft policy or quantized entry.
		const stored =
			typeof storedValue === 'number'
				? engine.decompose(storedValue, storageUnit, displayUnit, storageDigits)
				: null

		let major: number | null
		if (dirty.primary) {
			major = parseDraft(drafts.primary)
			if (major !== null && entry === 'quantize') {
				major = roundTo(major, engine.precisionFor(compound.major, precision))
			}
		} else {
			major = stored ? stored.major : parseDraft(drafts.primary)
		}
		if (major === null) return null

		const rawMinor = dirty.minor ? (parseDraft(drafts.minor) ?? 0) : (stored?.minor ?? 0)
		const minor =
			dirty.minor && entry === 'quantize'
				? roundTo(rawMinor, engine.precisionFor(displayUnit, precision))
				: rawMinor
		const maxMinor = compound.ratio - 0.001
		// Clamp the magnitude only: decompose is sign-safe and negative drafts
		// carry the sign on both parts, so zeroing a negative minor would corrupt
		// the round-trip.
		const clampedMinor = dirty.minor
			? Math.sign(minor) * Math.min(Math.abs(minor), maxMinor)
			: minor

		return roundTo(
			engine.compose({ major, minor: clampedMinor }, displayUnit, storageUnit),
			storageDigits
		)
	}

	if (!dirty.primary) return storedValue
	const parsed = parseDraft(drafts.primary)
	if (parsed === null) return null
	const value =
		entry === 'quantize' ? roundTo(parsed, engine.precisionFor(displayUnit, precision)) : parsed
	return roundTo(engine.convert(value, displayUnit, storageUnit), storageDigits)
}

/**
 * Drafts for repainting from a stored value. 'faithful' (default) is the shortest
 * draft that commits back to the stored value: display precision first, then one
 * more fraction digit at a time up to storage precision, since a draft that
 * silently truncates the stored value would write the truncation back on the next
 * save. 'display' skips escalation and renders straight at display digits
 * (compound parts each at their own digits), trading faithfulness for a value that
 * always matches what the unit picker promises.
 */
export const draftsFor = (value: number | null, opts: UnitContext): MeasurementDrafts => {
	if (typeof value !== 'number' || Number.isNaN(value)) return { minor: '', primary: '' }
	const {
		displayUnit,
		draft = 'faithful',
		engine,
		precision,
		storageDigits = STORAGE_FRACTION_DIGITS,
		storageUnit,
	} = opts
	const draftAt = (digits: number): MeasurementDrafts => {
		if (engine.isCompoundUnit(displayUnit)) {
			const parts = engine.decompose(value, storageUnit, displayUnit, digits)
			return { minor: numberToDraft(parts.minor), primary: numberToDraft(parts.major) }
		}
		const converted = roundTo(engine.convert(value, storageUnit, displayUnit), digits)
		return { minor: '', primary: numberToDraft(converted) }
	}

	const displayDigits = engine.precisionFor(displayUnit, precision)
	if (draft === 'display') return draftAt(displayDigits)

	// Digits past storage precision never survive a save, so that is where escalation stops.
	const maxDigits = Math.max(displayDigits, storageDigits)
	const target = roundTo(value, storageDigits)
	for (let digits = displayDigits; digits < maxDigits; digits++) {
		const candidate = draftAt(digits)
		if (commitDrafts(candidate, opts) === target) return candidate
	}
	return draftAt(maxDigits)
}
