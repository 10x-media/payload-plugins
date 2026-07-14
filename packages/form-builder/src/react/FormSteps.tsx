'use client'

import { stepLabel } from '../flow/stepLabel'
import { keys } from '../translations/keys'
import { cn } from './cn'
import { useFormContext } from './FormContext'

export type FormStepsProps = {
	/** Additional CSS class on the wrapping `.fb-form-steps` list. */
	className?: string
}

/**
 * Step-progress indicator for multi-step forms: an ordered list of the flow's steps with the
 * current one marked via `aria-current="step"` and a `--current` class. Step labels use the
 * step's title, falling back to the translated "Step {n}" (same semantics as the admin flow
 * builder). Carries no styling opinions beyond `fb-form-steps` classes. Renders nothing when
 * the form has fewer than two steps. Must render inside `<Form>`.
 */
export const FormSteps = ({ className }: FormStepsProps) => {
	const { step, t } = useFormContext()
	const steps = step.flow?.steps
	if (!steps || steps.length < 2) {
		return null
	}
	const fallbackTitle = t(keys.flowStepFallbackTitle)
	return (
		<ol className={cn('fb-form-steps', className)}>
			{steps.map((flowStep, index) => {
				const current = index === step.stepIndex
				return (
					<li
						key={flowStep.id}
						className={cn('fb-form-steps__step', current && 'fb-form-steps__step--current')}
						aria-current={current ? 'step' : undefined}
					>
						{stepLabel(flowStep, index, fallbackTitle)}
					</li>
				)
			})}
		</ol>
	)
}
