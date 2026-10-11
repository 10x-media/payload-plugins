'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Sidebar entry for the dev app's chat example. */
export const ChatNavLink = () => {
	const { config } = useConfig()
	const pathname = usePathname()
	const href = `${config.routes.admin}/chat`
	return (
		<Link className={`nav__link${pathname === href ? ' active' : ''}`} href={href} prefetch={false}>
			<span className="nav__link-label">Chat</span>
		</Link>
	)
}
