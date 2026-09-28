'use client'

import { CLIENT_FETCH_TIMEOUT_MS } from '../plugin/constants'

export const ImpersonationFrontendExit = ({
	apiPath,
	className,
	label,
}: {
	apiPath: string
	className?: string
	label: string
}) => {
	const onClick = async () => {
		const response = await fetch(`${apiPath}/exit`, {
			body: '{}',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
			signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
		})
		if (!response.ok) {
			return
		}
		window.location.reload()
	}

	return (
		<button
			className={className}
			data-testid="impersonation-exit"
			onClick={() => void onClick()}
			type="button"
		>
			{label}
		</button>
	)
}
