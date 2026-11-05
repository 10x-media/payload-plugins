'use client'

import { usePathname } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { ImpersonationBar } from './ImpersonationBar'
import { useImpersonationClient } from './ImpersonationConfig'

/**
 * Payload's `header` slot: the bar in the flow of the page, above the nav and
 * the content, so it covers nothing. The default template renders the slot on
 * every view that has the nav.
 */
export const ImpersonationHeader = () => {
	const bar = useImpersonationClient()?.bar
	return bar ? <ImpersonationBar {...bar} placement="header" /> : null
}

/**
 * The bar for admin pages without the default template (and so without the
 * `header` slot), such as `/admin/unauthorized`: pinned to the bottom. It
 * renders after mount, once the page shows which template it has.
 */
export const ImpersonationFixedBar = () => {
	const bar = useImpersonationClient()?.bar
	const pathname = usePathname()
	const [withoutHeader, setWithoutHeader] = useState(false)

	useEffect(() => {
		void pathname
		setWithoutHeader(!document.querySelector('.template-default'))
	}, [pathname])

	return bar && withoutHeader ? <ImpersonationBar {...bar} placement="fixed" /> : null
}
