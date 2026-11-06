'use client'

import { type StepNavItem, useStepNav } from '@payloadcms/ui'
import { useEffect, useRef } from 'react'

/**
 * WORKAROUND. Keeps the page's breadcrumbs while a panel is open.
 *
 * Payload's edit view decides it is in a drawer from `DocumentDrawerCallbacksContext`, which only
 * Payload can provide (see `documentActions.tsx`). In the pane it therefore renders as a page and
 * its `SetDocumentStepNav` writes the pane's document into the app header's breadcrumbs, behind
 * the panel. Payload 4 keeps one step nav for the whole admin, so nothing scopes that write to the
 * panel either: `StepNavProvider` is not exported.
 *
 * Called by the document pane, which mounts a round trip before the edit view inside it: the crumbs
 * the page has at that moment are put back whenever the view replaces them, and once more when the
 * pane unmounts. `SetDocumentStepNav` does not depend on the step nav, so restoring it does not
 * make it write again.
 */
export const usePageStepNav = (): void => {
	const { setStepNav, stepNav } = useStepNav()
	const pageStepNav = useRef<StepNavItem[]>(stepNav)
	const setRef = useRef(setStepNav)
	setRef.current = setStepNav

	useEffect(() => {
		if (stepNav !== pageStepNav.current) {
			setStepNav(pageStepNav.current)
		}
	}, [setStepNav, stepNav])

	useEffect(
		() => () => {
			setRef.current(pageStepNav.current)
		},
		[]
	)
}
