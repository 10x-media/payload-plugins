'use client'

import { Gutter } from '@payloadcms/ui'
import type React from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { useFormVariants, useWizard } from '../context'
import { FieldStep } from '../FieldStep'
import { useRunnerInternals } from '../Runner'
import { resolveSlot } from '../slots'
import { Navigation } from './Navigation'
import { Outcome } from './Outcome'
import { Progress } from './Progress'
import { StepHeader } from './StepHeader'

/** The current step's fields or component. A custom `Layout` places it where it likes. */
export const StepBody: React.FC = () => {
	const { readOnly, step, variant } = useWizard()
	const { rendered } = useRunnerInternals()
	if (!step) {
		return null
	}
	if (step.kind === 'component') {
		return (
			<div className={`${BASE_CLASS}__component-step`}>
				{rendered[`${variant.key}/${step.key}`]}
			</div>
		)
	}
	return <FieldStep readOnly={readOnly} step={step} />
}

/**
 * Each chrome part resolved through the slot precedence, falling back to the built-in. A slot
 * set to `false` resolves to `false`, which renders nothing, so a custom `Layout` built from
 * these gets hiding for free.
 */
export const ProgressSlot: React.FC = () => {
	const { slotLevels } = useRunnerInternals()
	return resolveSlot('Progress', slotLevels) ?? <Progress />
}

export const StepHeaderSlot: React.FC = () => {
	const { slotLevels } = useRunnerInternals()
	return resolveSlot('StepHeader', slotLevels) ?? <StepHeader />
}

export const NavigationSlot: React.FC = () => {
	const { slotLevels } = useRunnerInternals()
	return resolveSlot('Navigation', slotLevels) ?? <Navigation />
}

export const OutcomeSlot: React.FC = () => {
	const { slotLevels } = useRunnerInternals()
	return resolveSlot('Outcome', slotLevels) ?? <Outcome />
}

/**
 * The built-in layout: the step column (upload area, progress tabs, step header, the step
 * itself) and the sticky footer below it, each part hidden when its slot is set to `false`.
 * After `finish()` or an `outcome` after-save action, the outcome replaces steps and footer.
 */
export const DefaultLayout: React.FC = () => {
	const { outcome } = useFormVariants()
	const { beforeSteps } = useRunnerInternals()

	if (outcome !== null) {
		return (
			<Gutter className={`${BASE_CLASS}__body`}>
				<div className={`${BASE_CLASS}__column`}>
					<OutcomeSlot />
				</div>
			</Gutter>
		)
	}

	return (
		<>
			<Gutter className={`${BASE_CLASS}__body`}>
				<div className={`${BASE_CLASS}__column`}>
					{beforeSteps}
					<ProgressSlot />
					<StepHeaderSlot />
					<div className={`${BASE_CLASS}__step`}>
						<StepBody />
					</div>
				</div>
			</Gutter>
			<NavigationSlot />
		</>
	)
}
