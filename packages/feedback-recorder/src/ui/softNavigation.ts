'use client'

import { useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { type NavigateEventLike, softNavigationTarget } from './softNavigationTarget'

type NavigationLike = {
	addEventListener: (type: 'navigate', listener: (event: NavigateEventLike) => void) => void
	removeEventListener: (type: 'navigate', listener: (event: NavigateEventLike) => void) => void
}

/**
 * While `active`, turns full page loads into the admin into client-side navigations, so a plain
 * link anywhere in the admin (the host's own components, other plugins) does not end the
 * recording. Browsers without the Navigation API keep the leave warning as their only guard.
 */
export const useSoftAdminNavigation = (active: boolean): void => {
	const router = useRouter()
	const {
		config: {
			routes: { admin: adminRoute },
		},
	} = useConfig()

	useEffect(() => {
		const navigation = (window as Window & { navigation?: NavigationLike }).navigation
		if (!active || !navigation) return
		const onNavigate = (event: NavigateEventLike): void => {
			const target = softNavigationTarget(event, { origin: window.location.origin, adminRoute })
			if (!target) return
			event.preventDefault()
			if (event.navigationType === 'replace') router.replace(target)
			else router.push(target)
		}
		navigation.addEventListener('navigate', onNavigate)
		return () => navigation.removeEventListener('navigate', onNavigate)
	}, [active, adminRoute, router])
}
