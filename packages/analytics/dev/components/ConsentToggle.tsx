'use client'

import { useAnalytics } from '@10x-media/analytics/react'
import type { GateState } from '@10x-media/analytics/tracker'
import { useEffect, useState } from 'react'

/** Where this stand-in keeps the visitor's choice: the host's own storage, never the plugin's. */
const CHOICE_KEY = 'dev-consent-manager:analytics'

type Choice = 'allowed' | 'refused'

const readChoice = (): Choice | null => {
	try {
		const stored = window.localStorage.getItem(CHOICE_KEY)
		return stored === 'allowed' || stored === 'refused' ? stored : null
	} catch {
		// Storage blocked: the visitor has not chosen yet as far as this page knows.
		return null
	}
}

export interface ConsentToggleProps {
	/**
	 * Keep the choice in the host's storage and restate it on every load. Off for the vendor e2e
	 * mode, whose specs assert that nothing at all is stored before or after an answer.
	 */
	remember?: boolean
	/** Also answer each slot on its own, for the e2e check that two clients switch independently. */
	perSlot?: boolean
}

/**
 * A stand-in for the site's consent manager, c15t on a real site: it keeps the visitor's choice
 * itself and states it to the plugin on every page load, which is all the gate needs. Its effect
 * runs before the tracker has booted, so it also exercises a `setGate` held for the boot.
 */
export const ConsentToggle = ({ remember = true, perSlot = false }: ConsentToggleProps) => {
	const { setGate, gate } = useAnalytics()
	const [choice, setChoice] = useState<Choice | null>(null)

	useEffect(() => {
		if (!remember) {
			return
		}
		const stored = readChoice()
		setChoice(stored)
		if (stored) {
			setGate(stored === 'allowed')
		}
	}, [remember, setGate])

	const choose = (next: Choice) => {
		if (remember) {
			try {
				window.localStorage.setItem(CHOICE_KEY, next)
			} catch {
				// Storage blocked: the choice holds for this page only.
			}
		}
		setChoice(next)
		setGate(next === 'allowed')
	}

	const answer = (state: GateState) => () => setGate(state)

	return (
		<aside
			aria-label="Demo consent manager"
			data-gate-global={gate.global}
			data-gate-tenant={gate.tenant}
			style={{
				border: '1px dashed color-mix(in srgb, CanvasText 30%, transparent)',
				borderRadius: '0.75rem',
				margin: '2rem 0',
				padding: '1rem 1.25rem',
			}}
		>
			<p style={{ margin: '0 0 0.75rem' }}>
				Demo consent manager. Choice: <strong>{choice ?? 'none yet'}</strong>. Gate:{' '}
				<code>global {gate.global}</code>, <code>tenant {gate.tenant}</code>.
			</p>
			<button onClick={() => choose('allowed')} type="button">
				Allow analytics
			</button>{' '}
			<button onClick={() => choose('refused')} type="button">
				Refuse analytics
			</button>
			{perSlot ? (
				<p style={{ margin: '0.75rem 0 0' }}>
					<button onClick={answer({ global: true })} type="button">
						Allow global slot
					</button>{' '}
					<button onClick={answer({ global: false })} type="button">
						Refuse global slot
					</button>{' '}
					<button onClick={answer({ tenant: true })} type="button">
						Allow tenant slot
					</button>{' '}
					<button onClick={answer({ tenant: false })} type="button">
						Refuse tenant slot
					</button>
				</p>
			) : null}
		</aside>
	)
}
