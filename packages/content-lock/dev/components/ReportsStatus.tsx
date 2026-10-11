'use client'

import { useContentLock } from '@10x-media/content-lock/client'

/** What a custom view reads from the lock for its own target. */
export const ReportsStatus = () => {
	const { isLocked } = useContentLock()
	return isLocked({ type: 'custom', slug: 'reports' }) ? (
		<p>Reports are locked: generating one is paused until the lock ends.</p>
	) : (
		<p>Reports are open.</p>
	)
}
