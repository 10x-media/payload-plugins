'use client'

import { Link } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'

const HREF = '/admin/dedupe'

/** Dev stand only: the sidebar link to the plugin's queue, styled as the admin's own entries. */
export function DedupeNav() {
	const pathname = usePathname()
	const active = pathname === HREF || pathname?.startsWith(`${HREF}/`)
	return (
		<Link className="nav__link" href={HREF} id="nav-dedupe" prefetch={false}>
			{active ? <div className="nav__link-indicator" /> : null}
			<span className="nav__link-label">Duplicates</span>
		</Link>
	)
}
