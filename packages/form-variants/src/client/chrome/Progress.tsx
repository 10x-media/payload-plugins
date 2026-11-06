'use client'

import { ErrorPill, TabButton, TabsList } from '@payloadcms/ui'
import type React from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useWizard } from '../context'

/**
 * The visible steps as a row of Payload's own tabs. Under `navigation: 'free'` they behave as
 * tabs: any one opens, the current one is underlined. Under `linear` the underline also runs
 * under every step already passed, so the rail doubles as the progress bar, and a step opens
 * once it has been visited. A step with failing fields takes the tabs' own error state and
 * Payload's error pill, as its native tabs do. Renders nothing for a single step.
 */
export const Progress: React.FC = () => {
	const { i18n, t } = useTranslation()
	const { busy, canGoTo, errorCount, goTo, index, steps, variant } = useWizard()
	if (steps.length < 2) {
		return null
	}
	const free = variant.navigation === 'free'

	return (
		<nav
			aria-label={t(keys.progress)}
			className={`${BASE_CLASS}__progress ${BASE_CLASS}__progress--${variant.navigation}`}
		>
			<TabsList className={`${BASE_CLASS}__progress-list`}>
				{steps.map((step, i) => {
					const state = i < index ? 'done' : i === index ? 'current' : 'todo'
					const reachable = canGoTo(step.key)
					const errors = errorCount(step.key)
					return (
						<TabButton
							className={[
								`${BASE_CLASS}__progress-tab`,
								`${BASE_CLASS}__progress-item--${state}`,
								errors > 0 && `${BASE_CLASS}__progress-item--has-error`,
							]
								.filter(Boolean)
								.join(' ')}
							disabled={!reachable && state !== 'current'}
							hasError={errors > 0}
							isActive={state === 'current'}
							key={step.key}
							onClick={() => {
								if (reachable && !busy) {
									void goTo(step.key)
								}
							}}
						>
							{step.label ?? step.key}
							{errors > 0 && (
								<>
									<ErrorPill count={errors} i18n={i18n} />
									<span className="sr-only">
										{` (${errors} ${i18n.t(errors > 1 ? 'general:errors' : 'general:error')})`}
									</span>
								</>
							)}
							{state === 'done' && !free && (
								<span className="sr-only"> ({t(keys.stepCompleted)})</span>
							)}
						</TabButton>
					)
				})}
			</TabsList>
		</nav>
	)
}
