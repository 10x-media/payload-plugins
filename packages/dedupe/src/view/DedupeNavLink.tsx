'use client'

import { Link } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

type DedupeNavLinkProps = {
	/** Admin-prefixed href the plugin resolved at config time. */
	href: string
	/** `view.navLabel`: a plain string, or a map keyed by admin language code. */
	label?: Record<string, string> | string
	kind?: 'history' | 'queue'
	/** A path under `href` with its own entry, where this one is not active. */
	except?: string
}

const baseClass = 'nav'

/** A blank override is an unset one: an empty nav entry is worse than the default label. */
const usable = (value: string | undefined): string | undefined =>
	value && value.trim() !== '' ? value : undefined

const within = (pathname: string | null, href: string): boolean =>
	pathname === href || Boolean(pathname?.startsWith(`${href}/`))

/**
 * An entry of the queue or the merge history in the admin nav, styled with Payload's own
 * nav classes so it sits with the collection links rather than beside them. Mounted
 * through `afterNavLinks`.
 */
export function DedupeNavLink({ except, href, kind = 'queue', label }: DedupeNavLinkProps) {
	const { i18n, t } = useTranslation()
	const pathname = usePathname()

	const override =
		typeof label === 'string'
			? usable(label)
			: (usable(label?.[i18n.language]) ?? usable(label?.en))
	const text = override ?? t(kind === 'history' ? keys.historyTitle : keys.queueTitle)
	const id = kind === 'history' ? 'nav-dedupe-history' : 'nav-dedupe'

	const isActive = within(pathname, href) && !(except && within(pathname, except))
	const content = (
		<>
			{isActive && <div className={`${baseClass}__link-indicator`} />}
			<span className={`${baseClass}__link-label`}>{text}</span>
		</>
	)

	if (pathname === href) {
		return (
			<div className={`${baseClass}__link`} id={id}>
				{content}
			</div>
		)
	}

	return (
		<Link className={`${baseClass}__link`} href={href} id={id} prefetch={false}>
			{content}
		</Link>
	)
}
