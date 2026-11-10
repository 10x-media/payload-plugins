'use client'

import { Button, useRouter } from '@payloadcms/ui'
import { useTransition } from 'react'

/**
 * Tries a server-rendered read again: the router renders the page's server components anew, so a
 * widget or stat field whose source was busy reads it once more.
 */
export function RefreshButton({ label }: { label: string }) {
	const router = useRouter()
	const [pending, startTransition] = useTransition()
	return (
		<Button
			buttonStyle="secondary"
			disabled={pending}
			margin={false}
			onClick={() => startTransition(() => router.refresh())}
			size="medium"
		>
			{label}
		</Button>
	)
}
