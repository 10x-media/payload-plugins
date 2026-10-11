'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Sidebar entry for the dev app's UI playground. */
export const PlaygroundNavLink = () => {
	const { config } = useConfig()
	const pathname = usePathname()
	const href = `${config.routes.admin}/playground`
	return (
		<Link className={`nav__link${pathname === href ? ' active' : ''}`} href={href} prefetch={false}>
			<span className="nav__link-label">UI playground</span>
		</Link>
	)
}
