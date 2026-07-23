import type { Where } from 'payload'
import type { FlowStep, FormFlow } from './types'

const isRecord = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * Pure guard that normalizes a raw (possibly untrusted) flow value against the form's current
 * field keys (machine names for named fields, block row ids for bare blocks; see `fieldKey`).
 * Returns `undefined` when the flow is absent, empty, or resolves to fewer than two steps
 * (a single step is an ordinary form). A field assigned to multiple steps keeps only its
 * first occurrence in step order. `next: null` (explicit end of form) is preserved as distinct
 * from an absent `next` (sequential fall-through); a `next` pointing at an unknown step is
 * dropped to absent.
 *
 * A step is kept even when it ends up with no fields, which happens when every field it named was
 * deleted from the form. Dropping it would be wrong twice over: a host can render its own content
 * per step off `useFormStep()`, so an empty step is not necessarily an empty page, and dropping
 * one would strand the `next` and transition targets that point at it. The visitor gets a page with
 * only navigation on it, which is visible to the author in the flow builder and recoverable there.
 *
 * When `normalizeWhen` is provided, each transition's `when` is laundered through it (the same field
 * condition normalization); a transition whose `when` strips to nothing (an operand field was deleted)
 * is dropped rather than kept as an always-true route that would force navigation.
 */
export const normalizeFlow = (
	raw: unknown,
	fieldKeys: string[],
	normalizeWhen?: (raw: unknown) => Where | undefined
): FormFlow | undefined => {
	if (!isRecord(raw) || !Array.isArray(raw.steps)) {
		return undefined
	}

	const knownFields = new Set(fieldKeys)

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
			.map((t) => ({
				when: normalizeWhen ? normalizeWhen(t.when) : (t.when as Where),
				to: t.to as string,
			}))
			.filter((t): t is { when: Where; to: string } => t.when !== undefined)

		const next =
			s.next === null
				? null
				: typeof s.next === 'string' && knownIds.has(s.next)
					? (s.next as string)
					: undefined

		const step: FlowStep = { id, fields }
		if (typeof s.title === 'string') step.title = s.title
		if (transitions.length > 0) step.transitions = transitions
		if (next !== undefined) step.next = next

		return step
	})

	return { steps }
}
