'use client'

import { useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Dev-only sidebar link to the file icon gallery, styled as a Payload nav link. */
export const FileIconsNavLink = () => {
	const { config } = useConfig()
	const href = `${config.routes.admin}/file-icons`
	const active = usePathname() === href
	return (
		<Link className={['nav__link', active && 'active'].filter(Boolean).join(' ')} href={href}>
			{active ? <div className="nav__link-indicator" /> : null}
			<span className="nav__link-label">File icons</span>
		</Link>
	)
}
