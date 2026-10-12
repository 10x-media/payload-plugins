'use client'

import { Link } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { resolveNavLabel } from './navLabel'

/** @internal */
export interface AnalyticsNavLinkProps {
	/** Admin-prefixed href the plugin resolved at config time. */
	href: string
	/** `view.navLabel`: a plain string, or a map keyed by admin language code. */
	label?: string | Record<string, string>
}

const baseClass = 'nav'

/**
 * Analytics nav entry, styled with Payload's nav classes so it sits with the collection links
 * rather than beside them.
 *
 * @internal
 */
export function AnalyticsNavLink({ href, label }: AnalyticsNavLinkProps) {
	const { i18n, t } = useTranslation()
	const pathname = usePathname()

	const text = resolveNavLabel({
		...(label === undefined ? {} : { label }),
		language: i18n.language,
		fallbackLanguage: i18n.fallbackLanguage,
		fallback: t(keys.viewNavLabel),
	})

	const isActive = pathname === href || Boolean(pathname?.startsWith(`${href}/`))
	const content = (
		<>
			{isActive && <div className={`${baseClass}__link-indicator`} />}
			<span className={`${baseClass}__link-label`}>{text}</span>
		</>
	)

	if (pathname === href) {
		return (
			<div className={`${baseClass}__link`} id="nav-analytics">
				{content}
			</div>
		)
	}

	return (
		<Link className={`${baseClass}__link`} href={href} id="nav-analytics" prefetch={false}>
			{content}
		</Link>
	)
}
