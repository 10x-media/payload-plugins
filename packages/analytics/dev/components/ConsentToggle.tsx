'use client'

import { useAnalytics } from '@10x-media/analytics/react'
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

/**
 * A stand-in for the site's consent manager, c15t on a real site: it keeps the visitor's choice
 * itself and states it to the plugin on every page load, which is all the gate needs. Its effect
 * runs before the tracker has booted, so it also exercises a `setGate` held for the boot.
 */
export const ConsentToggle = () => {
	const { setGate, gate } = useAnalytics()
	const [choice, setChoice] = useState<Choice | null>(null)

	useEffect(() => {
		const stored = readChoice()
		setChoice(stored)
		if (stored) {
			setGate(stored === 'allowed')
		}
	}, [setGate])

	const choose = (next: Choice) => {
		try {
			window.localStorage.setItem(CHOICE_KEY, next)
		} catch {
			// Storage blocked: the choice holds for this page only.
		}
		setChoice(next)
		setGate(next === 'allowed')
	}

	return (
		<aside
			aria-label="Demo consent manager"
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
		</aside>
	)
}
