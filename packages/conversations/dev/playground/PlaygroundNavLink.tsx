'use client'

import { Link, useConfig, usePathname } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'

/** Sidebar entry for the dev app's UI playground, marked up like Payload's own nav links. */
export const PlaygroundNavLink = () => {
	const {
		config: {
			routes: { admin },
		},
	} = useConfig()
	const pathname = usePathname()
	const href = formatAdminURL({ adminRoute: admin, path: '/playground' })
	const active = pathname === href
	return (
		<div className="nav__link-wrapper">
			<Link
				aria-current={active ? 'page' : undefined}
				className={`nav__link${active ? ' nav__link--selected' : ''}`}
				href={href}
				prefetch={false}
			>
				<span className="nav__link-label">UI playground</span>
			</Link>
		</div>
	)
}
