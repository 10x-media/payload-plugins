'use client'

import { useWizard } from '@10x-media/form-variants/client'
import type React from 'react'

import './dev.css'

/**
 * A "Step 2 of 5" counter as a replacement for the built-in `Progress` slot.
 *
 * The built-in draws a rail of named tabs, which suits a variant whose steps are sections to
 * jump between. A guided sequence often wants the plain count instead, and that is one
 * component: everything it needs is on `useWizard()`. `count` is the number of *visible* steps,
 * so a step whose `condition` turned false is already out of it and the total moves on its own.
 *
 * Set as `components: { Progress: '...' }` on the plugin, a collection, a variant or a single
 * step. The same component works inside a replaced `Navigation` or a custom `Layout`; nothing
 * here depends on where it renders.
 */
export const StepCounter: React.FC = () => {
	const { count, index, step, steps } = useWizard()

	if (count < 2) {
		return null
	}

	return (
		<div className="dev-counter">
			<div className="dev-counter__line">
				<p className="dev-counter__count">
					Step {index + 1} of {count}
				</p>
				{step?.label && <p className="dev-counter__label">{step.label}</p>}
			</div>
			<ol aria-hidden className="dev-counter__bar">
				{steps.map((candidate, i) => (
					<li
						className={`dev-counter__segment${i <= index ? ' dev-counter__segment--done' : ''}`}
						key={candidate.key}
					/>
				))}
			</ol>
		</div>
	)
}
