'use client'

import { Button } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * Tries a server-rendered read again: Next renders the page's server components anew, so a
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
			size="small"
		>
			{label}
		</Button>
	)
}
