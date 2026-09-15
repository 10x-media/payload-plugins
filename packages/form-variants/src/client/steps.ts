import type { FormState } from 'payload'

import type { ClientFieldItem, ClientStep } from './types'

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
	if (hasComponentItem(step.items)) {
		return true
	}
	const paths = Array.from(formStatePaths)
	return itemPaths(step.items).some((itemPath) => paths.some((path) => isUnderPath(path, itemPath)))
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

/**
 * The field paths a step lists, flattened: the containers a step draws around its fields are
 * presentational and nest without touching a path.
 */
export const itemPaths = (items: ClientFieldItem[]): string[] =>
	items.flatMap((item) => {
		if (item.type === 'field') {
			return [item.path]
		}
		return 'items' in item ? itemPaths(item.items) : []
	})

/** Whether anywhere in the tree a step draws a component of its own. */
export const hasComponentItem = (items: ClientFieldItem[]): boolean =>
	items.some((item) =>
		item.type === 'component' ? true : 'items' in item && hasComponentItem(item.items)
	)

/** Form state paths of one step, prefix-matched so nested paths count. */
export const stepPaths = (step: ClientStep, formState: FormState): string[] => {
	const paths = itemPaths(step.items)
	return Object.keys(formState).filter((path) =>
		paths.some((itemPath) => isUnderPath(path, itemPath))
	)
}

/**
 * How many fields of the step are failing validation in the given state. Form state carries
 * `valid` only once the form has been submitted once, so this is zero until a move or a save
 * was refused, which is when Payload starts showing field errors too.
 */
export const stepErrorCount = (step: ClientStep, formState: FormState): number =>
	stepPaths(step, formState).filter((path) => {
		const field = formState[path]
		return Boolean(field) && field?.passesCondition !== false && field?.valid === false
	}).length

/** Whether every field of the step passed validation in the given state. */
export const stepIsValid = (step: ClientStep, formState: FormState): boolean =>
	stepErrorCount(step, formState) === 0
