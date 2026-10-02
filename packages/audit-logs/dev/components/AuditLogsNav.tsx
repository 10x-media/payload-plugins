'use client'

import { Link, NavGroup, useConfig } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'

const VIEWS: { label: string; path: `/${string}` }[] = [
	{ label: 'All entries', path: '/audit-logs' },
	{ label: 'Current tenant', path: '/audit-logs-tenant' },
]

/**
 * Both log views in the sidebar, marked up like Payload's own nav links. The
 * plugin registers them as custom views, which the nav does not list by itself.
 */
export function AuditLogsNav() {
	const {
		config: {
			routes: { admin },
		},
	} = useConfig()
	const pathname = usePathname()

	return (
		<NavGroup label="Audit log views">
			{VIEWS.map(({ label, path }) => {
				const href = formatAdminURL({ adminRoute: admin, path })
				const active = pathname === href
				return (
					<Link className="nav__link" href={href} id={`nav-${path.slice(1)}`} key={path}>
						{active && <div className="nav__link-indicator" />}
						<span className="nav__link-label">{label}</span>
					</Link>
				)
			})}
		</NavGroup>
	)
}
