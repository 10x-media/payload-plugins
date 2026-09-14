'use client'

import type React from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useWizard } from '../context'

/**
 * The visible steps as a row of tabs. Under `navigation: 'free'` they behave as tabs: any one
 * opens, the current one is underlined. Under `linear` the underline runs through every step
 * already passed up to the current one, so the rail doubles as the progress bar, and only
 * steps behind the current one open. Renders nothing for a single step.
 */
export const Progress: React.FC = () => {
	const { t } = useTranslation()
	const { busy, goTo, index, steps, variant } = useWizard()
	if (steps.length < 2) {
		return null
	}
	const free = variant.navigation === 'free'

	return (
		<nav
			aria-label={t(keys.progress)}
			className={`${BASE_CLASS}__progress ${BASE_CLASS}__progress--${variant.navigation}`}
		>
			<ol className={`${BASE_CLASS}__progress-list`}>
				{steps.map((step, i) => {
					const state = i < index ? 'done' : i === index ? 'current' : 'todo'
					const reachable = state !== 'current' && (free || i < index)
					return (
						<li
							className={`${BASE_CLASS}__progress-item ${BASE_CLASS}__progress-item--${state}`}
							key={step.key}
						>
							<button
								aria-current={state === 'current' ? 'step' : undefined}
								className={`${BASE_CLASS}__progress-tab`}
								disabled={state === 'todo' && !free}
								onClick={reachable && !busy ? () => void goTo(step.key) : undefined}
								type="button"
							>
								{step.label ?? step.key}
								{state === 'done' && !free && (
									<span className="sr-only"> ({t(keys.stepCompleted)})</span>
								)}
							</button>
						</li>
					)
				})}
			</ol>
		</nav>
	)
}
