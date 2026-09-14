import type { FormState } from 'payload'

import type { ClientStep } from './types'

/** Whether `path` is `itemPath` or nested below it. */
export const isUnderPath = (path: string, itemPath: string): boolean =>
	path === itemPath || path.startsWith(`${itemPath}.`)

/**
 * Whether a field step has anything to draw for this account: a listed path that exists in
 * form state (a field this account may not read, or a hidden one, is absent), or a component
 * item. Component steps always render.
 */
export const stepIsRenderable = (step: ClientStep, formStatePaths: Iterable<string>): boolean => {
	if (step.kind === 'component') {
		return true
	}
	const paths = Array.from(formStatePaths)
	return step.items.some((item) =>
		item.type === 'component' ? true : paths.some((path) => isUnderPath(path, item.path))
	)
}

/** The steps to show, in order: condition passed and something to render. */
export const visibleSteps = (
	steps: ClientStep[],
	visibleKeys: ReadonlySet<string>,
	renderableKeys: ReadonlySet<string>
): ClientStep[] => steps.filter((step) => visibleKeys.has(step.key) && renderableKeys.has(step.key))

/** The step to open: the requested key when it is visible, else the first visible step. */
export const resolveStepKey = (steps: ClientStep[], requested: null | string): null | string => {
	if (requested && steps.some((step) => step.key === requested)) {
		return requested
	}
	return steps[0]?.key ?? null
}

/** Form state paths of one step, prefix-matched so nested paths count. */
export const stepPaths = (step: ClientStep, formState: FormState): string[] => {
	const itemPaths = step.items.flatMap((item) => (item.type === 'field' ? [item.path] : []))
	return Object.keys(formState).filter((path) =>
		itemPaths.some((itemPath) => isUnderPath(path, itemPath))
	)
}

/** Whether every field of the step passed validation in the given state. */
export const stepIsValid = (step: ClientStep, formState: FormState): boolean =>
	stepPaths(step, formState).every((path) => {
		const field = formState[path]
		return !field || field.passesCondition === false || field.valid !== false
	})
