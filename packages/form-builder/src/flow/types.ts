import type { Where } from 'payload'

/** A conditional edge: when `when` matches the answers, route to step `to`. */
export type FlowTransition = { when: Where; to: string }

/** A flow step: a named group of fields, ordered transitions, and a default next edge. */
export type FlowStep = {
	id: string
	title?: string
	/** Field machine names rendered in this step (a subset of the form's fields). */
	fields: string[]
	/** Default next step id when no transition matches. Absent -> this step is terminal. */
	next?: string
	/** Ordered conditional edges; the first whose `when` matches the answers wins. */
	transitions?: FlowTransition[]
}

/** A serializable multi-step flow layered over the form's flat field list. */
export type FormFlow = { steps: FlowStep[] }
