import { readPath } from '../merge/compare'
import type { CompareFn, MatchFieldConfig } from '../options'
import { scalarsOf } from './normalize'

/** A match field with its comparison resolved and the path validated against the spec. */
export type ResolvedMatchField = MatchFieldConfig & {
	compare: CompareFn
	/** Read with every locale, so its value is a map of locales. */
	localized?: boolean
}

export type SignalKind = 'differ' | 'match' | 'similar' | 'veto'

/** How one match field compared. A field empty on either side says nothing and has none. */
export type MatchSignal = {
	path: string
	kind: SignalKind
	similarity: number
}

export type MatchResult = {
	/** 0..1. Not a probability. */
	score: number
	signals: MatchSignal[]
}

/** Values at or above this similarity count as the same value, one typo apart. */
export const SIMILAR_THRESHOLD = 0.85

/** Localized and `hasMany` values compare every member against every member, up to this many. */
const MAX_VALUES = 10

/** The scalars at `path`; a localized value is a map of locales, each of them a value. */
export const fieldValues = (
	doc: Record<string, unknown>,
	path: string,
	localized = false
): unknown[] => {
	const value = readPath(doc, path)
	const values =
		localized && value !== null && typeof value === 'object' && !Array.isArray(value)
			? Object.values(value)
			: [value]
	return values.flatMap(scalarsOf).slice(0, MAX_VALUES)
}

const bestSimilarity = (field: ResolvedMatchField, left: unknown[], right: unknown[]): number => {
	let best = 0
	for (const a of left) {
		for (const b of right) {
			const value = field.compare.similarity(a, b)
			if (value > best) best = value
			if (best >= 1) return 1
		}
	}
	return best
}

/**
 * Mild by default: two people share a name and a phone far more often than they share an
 * email, so one differing field must not outweigh two matching ones. A field whose
 * difference is decisive (a birth date, a tax id) sets its own `onDiffer` or a veto.
 */
export const differPenalty = (field: MatchFieldConfig): number | 'veto' =>
	field.onDiffer ?? -field.weight / 4

/**
 * Score two documents on the match fields. Weights sum toward a match, the differ
 * penalties argue against, and the largest attainable positive total is the normalizer.
 */
export const scorePair = (
	a: Record<string, unknown>,
	b: Record<string, unknown>,
	fields: readonly ResolvedMatchField[]
): MatchResult => {
	const signals: MatchSignal[] = []
	let raw = 0
	let maxPositive = 0

	for (const field of fields) {
		maxPositive += field.weight
		const left = fieldValues(a, field.path, field.localized)
		const right = fieldValues(b, field.path, field.localized)
		if (left.length === 0 || right.length === 0) continue
		const similarity = bestSimilarity(field, left, right)
		if (similarity >= 1) {
			signals.push({ path: field.path, kind: 'match', similarity })
			raw += field.weight
			continue
		}
		if (similarity >= SIMILAR_THRESHOLD) {
			signals.push({ path: field.path, kind: 'similar', similarity })
			raw += field.weight * similarity
			continue
		}
		const penalty = differPenalty(field)
		if (penalty === 'veto') {
			signals.push({ path: field.path, kind: 'veto', similarity })
			continue
		}
		signals.push({ path: field.path, kind: 'differ', similarity })
		raw += penalty
	}

	const vetoed = signals.some((signal) => signal.kind === 'veto')
	const score = vetoed || maxPositive === 0 ? 0 : Math.max(0, Math.min(1, raw / maxPositive))
	return { score, signals }
}
