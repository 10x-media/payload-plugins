import type { Where } from 'payload'
import type { FlowStep, FormFlow } from './types'

const isRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Pure guard that normalizes a raw (possibly untrusted) flow value against the
 * form's current field list. Returns `undefined` when the flow is absent, empty,
 * or resolves to fewer than two steps (a single step is an ordinary form).
 * A field assigned to multiple steps keeps only its first occurrence in step order.
 */
export const normalizeFlow = (raw: unknown, fieldNames: string[]): FormFlow | undefined => {
	if (!isRecord(raw) || !Array.isArray(raw.steps)) {
		return undefined
	}

	const knownFields = new Set(fieldNames)

	const rawSteps = raw.steps.filter(
		(s): s is Record<string, unknown> => isRecord(s) && typeof s.id === 'string'
	)

	const knownIds = new Set(rawSteps.map((s) => s.id as string))

	if (knownIds.size < 2) {
		return undefined
	}

	const seenFields = new Set<string>()

	const steps: FlowStep[] = rawSteps.map((s) => {
		const id = s.id as string

		const fields = Array.isArray(s.fields)
			? s.fields.filter((f): f is string => {
					if (typeof f !== 'string' || !knownFields.has(f) || seenFields.has(f)) return false
					seenFields.add(f)
					return true
				})
			: []

		const rawTransitions = Array.isArray(s.transitions) ? s.transitions : []
		const transitions = rawTransitions
			.filter(
				(t): t is Record<string, unknown> =>
					isRecord(t) &&
					typeof t.to === 'string' &&
					knownIds.has(t.to as string) &&
					isRecord(t.when)
			)
			.map((t) => ({ when: t.when as Where, to: t.to as string }))

		const next = typeof s.next === 'string' && knownIds.has(s.next) ? (s.next as string) : undefined

		const step: FlowStep = { id, fields }
		if (typeof s.title === 'string') step.title = s.title
		if (transitions.length > 0) step.transitions = transitions
		if (next !== undefined) step.next = next

		return step
	})

	return { steps }
}
