'use client'

import { useState } from 'react'

import { CLIENT_FETCH_TIMEOUT_MS } from '../plugin/constants'

/**
 * Posts to exit and reloads on success. A failed or timed-out request logs the
 * reason and re-enables the button, so a second click can retry.
 */
export const ImpersonationFrontendExit = ({
	apiPath,
	className,
	label,
}: {
	apiPath: string
	className?: string
	label: string
}) => {
	const [busy, setBusy] = useState(false)

	const onClick = async () => {
		setBusy(true)
		try {
			const response = await fetch(`${apiPath}/exit`, {
				body: '{}',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				method: 'POST',
				signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
			})
			if (response.ok) {
				window.location.reload()
				return
			}
			const body = (await response.json().catch(() => null)) as { error?: string } | null
			console.error(
				`@10x-media/impersonation: exit failed (${response.status}${body?.error ? `, ${body.error}` : ''})`
			)
		} catch (error) {
			console.error('@10x-media/impersonation: exit request failed', error)
		}
		setBusy(false)
	}

	return (
		<button
			aria-busy={busy}
			className={className}
			disabled={busy}
			onClick={() => void onClick()}
			type="button"
		>
			{label}
		</button>
	)
}
