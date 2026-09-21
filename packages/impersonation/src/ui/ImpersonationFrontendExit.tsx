'use client'

import { CLIENT_FETCH_TIMEOUT_MS } from '../plugin/constants'

export const ImpersonationFrontendExit = ({
	apiPath,
	label,
}: {
	apiPath: string
	label: string
}) => {
	const onClick = async () => {
		await fetch(`${apiPath}/exit`, {
			body: '{}',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
			signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
		})
		window.location.reload()
	}

	return (
		<button
			data-testid="impersonation-exit"
			onClick={() => void onClick()}
			style={{
				background: '#111',
				border: '1px solid #444',
				borderRadius: 4,
				color: '#fff',
				cursor: 'pointer',
				font: 'inherit',
				padding: '0.35rem 0.75rem',
			}}
			type="button"
		>
			{label}
		</button>
	)
}
