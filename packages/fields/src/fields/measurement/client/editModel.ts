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
	/**
	 * The compound drafts as painted on screen immediately before this edit (not the
	 * post-keystroke `drafts`). A display-digit repaint can carry (182.5 cm storage
	 * splits exactly to 5 ft 11.850394 in but paints as 6 ft 0 in), so when exactly
	 * one part is dirty, the edited part's contribution is computed as a delta off
	 * this baseline rather than a full replace, which would otherwise bake the
	 * painted carry into storage.
	 */
	paintedDrafts?: MeasurementDrafts
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
		paintedDrafts,
		precision,
		storageDigits = STORAGE_FRACTION_DIGITS,
		storageUnit,
		storedValue = null,
	} = opts

	if (engine.isCompoundUnit(displayUnit)) {
		const compound = COMPOUNDS[displayUnit]
		const hasStored = typeof storedValue === 'number'
		const dirtyCount = (dirty.primary ? 1 : 0) + (dirty.minor ? 1 : 0)

		// Delta path: exactly one part was touched and a painted baseline exists, so
		// the untouched part's contribution comes entirely from the exact stored
		// total (never its carried, display-precision draft), and the touched part
		// contributes only the change the viewer actually typed, in minor units.
		if (hasStored && dirtyCount === 1 && paintedDrafts) {
			const exact = engine.decompose(storedValue as number, storageUnit, displayUnit, storageDigits)
			const exactTotal = exact.major * compound.ratio + exact.minor

			if (dirty.primary) {
				let typedMajor = parseDraft(drafts.primary)
				if (typedMajor === null) return null
				if (entry === 'quantize') {
					typedMajor = roundTo(typedMajor, engine.precisionFor(compound.major, precision))
				}
				const paintedMajor = parseDraft(paintedDrafts.primary) ?? exact.major
				const newTotal = exactTotal + (typedMajor - paintedMajor) * compound.ratio
				return roundTo(
					engine.compose({ major: 0, minor: newTotal }, displayUnit, storageUnit),
					storageDigits
				)
			}

			const rawMinor = parseDraft(drafts.minor) ?? 0
			const typedMinor =
				entry === 'quantize'
					? roundTo(rawMinor, engine.precisionFor(displayUnit, precision))
					: rawMinor
			const paintedMinor = parseDraft(paintedDrafts.minor) ?? 0
			const newTotal = exactTotal + (typedMinor - paintedMinor)
			return roundTo(
				engine.compose({ major: 0, minor: newTotal }, displayUnit, storageUnit),
				storageDigits
			)
		}

		// Both parts dirty (an explicit full replace) or no baseline to diff
		// against: compose the two parts directly, as before.
		const stored = hasStored
			? engine.decompose(storedValue as number, storageUnit, displayUnit, storageDigits)
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

		let minor: number
		if (dirty.minor) {
			const rawMinor = parseDraft(drafts.minor) ?? 0
			const maxMinor = compound.ratio - 0.001
			// Clamp the raw typed magnitude (bounds a literal 24) before quantizing:
			// a quantized value landing exactly on the ratio (11.96 -> 12) must be
			// free to carry into the major via compose, matching decompose's own
			// carry contract, so nothing clamps it back down afterward.
			const clampedRaw = Math.sign(rawMinor) * Math.min(Math.abs(rawMinor), maxMinor)
			minor =
				entry === 'quantize'
					? roundTo(clampedRaw, engine.precisionFor(displayUnit, precision))
					: clampedRaw
		} else {
			minor = stored ? stored.minor : 0
		}

		return roundTo(engine.compose({ major, minor }, displayUnit, storageUnit), storageDigits)
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
	// A bare probe: never forward `opts` itself, so an entry/dirty/storedValue field
	// a future CommitOptions caller happens to carry can never poison this check.
	const probeOpts: UnitContext = { displayUnit, engine, precision, storageDigits, storageUnit }
	for (let digits = displayDigits; digits < maxDigits; digits++) {
		const candidate = draftAt(digits)
		if (commitDrafts(candidate, probeOpts) === target) return candidate
	}
	return draftAt(maxDigits)
}
