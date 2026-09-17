'use client'

export const ExitButton = () => {
	const onClick = async () => {
		await fetch('/api/impersonation/exit', {
			body: '{}',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
		})
		window.location.reload()
	}

	return (
		<button data-testid="impersonation-exit" onClick={() => void onClick()} type="button">
			Exit impersonation
		</button>
	)
}
