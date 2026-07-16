import type { Where } from 'payload'

/** A conditional edge: when `when` matches the answers, route to step `to`. */
export type FlowTransition = { when: Where; to: string }

/** A flow step: a named group of fields, ordered transitions, and a default next edge. */
export type FlowStep = {
	id: string
	title?: string
	/**
	 * Field keys rendered in this step (a subset of the form's fields): machine names for named
	 * fields, block row ids for bare (nameless) blocks. See `fieldKey`.
	 */
	fields: string[]
	/**
	 * Default next edge when no transition matches. Absent -> fall through to the next step in
	 * array order (the last step ends the form). `null` -> explicit end of form regardless of
	 * position. A step id -> jump to that step.
	 */
	next?: string | null
	/** Ordered conditional edges; the first whose `when` matches the answers wins. */
	transitions?: FlowTransition[]
}

/** A serializable multi-step flow layered over the form's flat field list. */
export type FormFlow = { steps: FlowStep[] }

/**
 * Reserved value the flow builder's next select maps to `next: null` (explicit end of form).
 * Builder-generated step ids are UUIDs (hex digits + dashes) and can never equal it;
 * `validateFlow` rejects API-authored steps claiming it as an id so the mapping stays unambiguous.
 */
export const END_OF_FORM = '__end__'
