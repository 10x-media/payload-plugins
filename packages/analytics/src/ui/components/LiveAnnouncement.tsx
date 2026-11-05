'use client'

import { useLiveAnnouncement } from '../hooks/useLiveAnnouncement'
import '../analytics.css'

/**
 * A hidden polite live region for a polled counter, saying only what {@link useLiveAnnouncement}
 * lets through, so a poll every few seconds never talks over the page.
 */
export function LiveAnnouncement({ message }: { message: string | null }) {
	const announced = useLiveAnnouncement(message)
	return (
		<span aria-atomic="true" aria-live="polite" className="analytics-sr-only">
			{announced}
		</span>
	)
}
