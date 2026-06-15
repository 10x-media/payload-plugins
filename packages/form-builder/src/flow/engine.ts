import { evaluateCondition } from '../conditions/evaluate'
import type { FlowStep, FormFlow } from './types'

/** The entry step id (the first step), or `undefined` for an empty flow. */
export const firstStepId = (flow: FormFlow): string | undefined => flow.steps[0]?.id

/** The step with the given id, or `undefined`. */
export const getStep = (flow: FormFlow, id: string): FlowStep | undefined =>
	flow.steps.find((step) => step.id === id)

/** The field machine names a step renders (empty for an unknown step). */
export const stepFieldNames = (flow: FormFlow, id: string): string[] =>
	getStep(flow, id)?.fields ?? []

/**
 * Resolve the next step id from the current step + answers: the first transition whose `when` matches
 * (via `evaluateCondition`), else the default `next`, else `undefined` (terminal). Pure + isomorphic.
 */
export const resolveNextStepId = (
	flow: FormFlow,
	currentId: string,
	answers: Record<string, unknown>
): string | undefined => {
	const step = getStep(flow, currentId)
	if (!step) {
		return undefined
	}
	for (const transition of step.transitions ?? []) {
		if (evaluateCondition(transition.when, answers)) {
			return transition.to
		}
	}
	return step.next
}

/** Whether the current step is terminal (no matching transition + no default next). */
export const isTerminalStepId = (
	flow: FormFlow,
	currentId: string,
	answers: Record<string, unknown>
): boolean => resolveNextStepId(flow, currentId, answers) === undefined
