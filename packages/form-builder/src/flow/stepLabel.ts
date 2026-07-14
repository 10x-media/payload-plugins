import type { FlowStep } from './types'

/**
 * Display label for a step: its trimmed title, else the fallback template with
 * `{n}` replaced by the 1-based index. Step ids never surface in the UI.
 * Lives with the flow engine (not the admin client module) because the frontend
 * `<FormSteps>` indicator resolves labels with the same semantics.
 */
export const stepLabel = (
	step: Pick<FlowStep, 'title'>,
	index: number,
	fallbackTemplate: string
): string => {
	const title = step.title?.trim()
	return title !== undefined && title.length > 0
		? title
		: fallbackTemplate.replace('{n}', String(index + 1))
}
