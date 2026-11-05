'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { RefreshProvider } from '../../../demo/refresh'

/** Re-renders the server page after a demo action, through Next's `router.refresh()`. */
export const NextRefresh = ({ children }: { children: ReactNode }) => {
	const router = useRouter()

	return <RefreshProvider refresh={() => router.refresh()}>{children}</RefreshProvider>
}
