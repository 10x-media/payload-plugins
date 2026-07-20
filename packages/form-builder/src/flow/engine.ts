import { evaluateCondition } from '../conditions/evaluate'
import type { FlowStep, FormFlow } from './types'

/** The entry step id (the first step), or `undefined` for an empty flow. */
export const firstStepId = (flow: FormFlow): string | undefined => flow.steps[0]?.id

/** The step with the given id, or `undefined`. */
export const getStep = (flow: FormFlow, id: string): FlowStep | undefined =>
	flow.steps.find((step) => step.id === id)

/** The field keys a step renders (names for named fields, block row ids for bare blocks; empty for an unknown step). */
export const stepFieldNames = (flow: FormFlow, id: string): string[] =>
	getStep(flow, id)?.fields ?? []

/**
 * Resolve the next step id from the current step + answers. Precedence: the first transition whose
 * `when` matches (via `evaluateCondition`) wins, else the step's `next` (a step id to jump to, or
 * `null` for an explicit end), else the next step in array order (the last step ends the flow).
 * Returns `undefined` when the flow ends here. Pure + isomorphic.
 */
export const resolveNextStepId = (
	flow: FormFlow,
	currentId: string,
	answers: Record<string, unknown>
): string | undefined => {
	const index = flow.steps.findIndex((step) => step.id === currentId)
	const step = flow.steps[index]
	if (!step) {
		return undefined
	}
	for (const transition of step.transitions ?? []) {
		if (evaluateCondition(transition.when, answers)) {
			return transition.to
		}
	}
	if (step.next === null) {
		return undefined
	}
	if (step.next !== undefined) {
		return step.next
	}
	return flow.steps[index + 1]?.id
}

/** Whether the flow ends at the current step (`resolveNextStepId` finds no step to advance to). */
export const isTerminalStepId = (
	flow: FormFlow,
	currentId: string,
	answers: Record<string, unknown>
): boolean => resolveNextStepId(flow, currentId, answers) === undefined
