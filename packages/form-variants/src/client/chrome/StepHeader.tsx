'use client'

import type React from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { useWizard } from '../context'
import { useRunnerInternals } from '../Runner'

/**
 * The current step's description, and its label too when no progress tabs are on screen to
 * show it already (a single step, or `Progress: false`).
 */
export const StepHeader: React.FC = () => {
	const { step } = useWizard()
	const { progressVisible } = useRunnerInternals()
	const label = progressVisible ? undefined : step?.label
	if (!step || (!label && !step.description)) {
		return null
	}
	return (
		<header className={`${BASE_CLASS}__step-header`}>
			{label && <h2 className={`${BASE_CLASS}__step-title`}>{label}</h2>}
			{step.description && <p className={`${BASE_CLASS}__step-description`}>{step.description}</p>}
		</header>
	)
}
