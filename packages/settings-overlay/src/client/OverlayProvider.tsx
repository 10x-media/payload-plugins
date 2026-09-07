'use client'

import { ConfirmationModal, useModal } from '@payloadcms/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { usePathname, useSearchParams } from 'next/navigation'
import type { ListQuery } from 'payload'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DISCARD_SLUG, panelSlugFor, QUERY_PARAM, SEARCH_PARAM } from '../plugin/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ClientOverlay, Manifest } from '../types'
import { InternalBadgeProvider } from './badges'
import { SettingsOverlayContext, type SettingsOverlayContextValue } from './context'
import { SettingsPanel } from './Overlay'
import { createOverlayQueryClient } from './queries'
import type { OverlaySlots } from './slots'
import {
	CLOSED,
	formatParam,
	formatQueryParam,
	parseParam,
	type State,
	sameState,
	sameUrlState,
} from './urlState'

export type SettingsOverlayClientProps = {
	children?: React.ReactNode
	/** Server-rendered icons, keyed by `overlayId` and `overlayId/itemSlug`. */
	icons: Record<string, React.ReactNode>
	lazyTransport: 'server-function' | 'widget'
	manifests: Record<string, Manifest>
	overlays: ClientOverlay[]
	/** Server-rendered eager `component` items, keyed by `overlayId/itemSlug`. */
	rendered: Record<string, React.ReactNode>
	slots?: Record<string, OverlaySlots>
}

/**
 * Owns which overlay is open and what it points at, and mounts each panel once.
 *
 * The URL carries `?settings=<overlay>/<item>[/<id>]`, written with the History API rather than
 * the router so opening a panel does not refetch the page underneath. Next reflects
 * pushState/replaceState into `useSearchParams`, which is how the browser back button closes
 * the panel: the parameter disappears and the effect below follows it.
 */
export const SettingsOverlayClient: React.FC<SettingsOverlayClientProps> = ({
	children,
	icons,
	lazyTransport,
	manifests,
	overlays,
	rendered,
	slots,
}) => {
	const searchParams = useSearchParams()
	const pathname = usePathname()
	const { openModal } = useModal()
	const { t } = useTranslation()
	const [queryClient] = useState(createOverlayQueryClient)

	const addressable = useMemo(
		() => new Set(overlays.filter((overlay) => overlay.addressable).map((overlay) => overlay.id)),
		[overlays]
	)

	const [state, setState] = useState<State>(() => {
		const fromUrl = parseParam(searchParams.get(SEARCH_PARAM), searchParams.get(QUERY_PARAM))
		return fromUrl.overlayId && addressable.has(fromUrl.overlayId) ? fromUrl : CLOSED
	})
	const [formModified, setFormModified] = useState(false)

	// Read by `setTarget`, which must write the URL outside the state updater: React may run an
	// updater twice, and `history.replaceState` is not a pure computation.
	const stateRef = useRef(state)
	stateRef.current = state
	const pendingAction = useRef<null | (() => void)>(null)

	const writeUrl = useCallback(
		(next: State, mode: 'push' | 'replace') => {
			if (typeof window === 'undefined') {
				return
			}
			const params = new URLSearchParams(window.location.search)
			const value = next.overlayId && addressable.has(next.overlayId) ? formatParam(next) : null
			if (value) {
				params.set(SEARCH_PARAM, value)
			} else {
				params.delete(SEARCH_PARAM)
			}
			const listQuery = value ? formatQueryParam(next.target.query as ListQuery | undefined) : null
			if (listQuery) {
				params.set(QUERY_PARAM, listQuery)
			} else {
				params.delete(QUERY_PARAM)
			}
			const query = params.toString()
			const url = `${pathname}${query ? `?${query}` : ''}${window.location.hash}`
			if (mode === 'push') {
				window.history.pushState(null, '', url)
			} else {
				window.history.replaceState(null, '', url)
			}
		},
		[addressable, pathname]
	)

	// Back and forward: the browser restores a URL and the panel follows it, including to closed.
	// Read straight from `window.location` so the decision is made before Next has re-rendered
	// with the restored search params.
	useEffect(() => {
		const onPopState = () => {
			const params = new URLSearchParams(window.location.search)
			const fromUrl = parseParam(params.get(SEARCH_PARAM), params.get(QUERY_PARAM))
			setState((current) => (sameUrlState(current, fromUrl) ? current : fromUrl))
		}
		window.addEventListener('popstate', onPopState)
		return () => {
			window.removeEventListener('popstate', onPopState)
		}
	}, [])

	// Every other URL change. A `settings` value that differs from the state is a link or a
	// navigation naming a panel: follow it. A URL with no `settings` while a panel is open is
	// somebody else's navigation, typically an embedded view paging with `router.push('?page=2')`,
	// which rewrites the whole query string: the panel stays open and puts its parameters back
	// beside theirs. Closing is only ever decided by `close()` or popstate.
	useEffect(() => {
		const fromUrl = parseParam(searchParams.get(SEARCH_PARAM), searchParams.get(QUERY_PARAM))
		const current = stateRef.current
		if (fromUrl.overlayId) {
			if (addressable.has(fromUrl.overlayId) && !sameUrlState(current, fromUrl)) {
				setState(fromUrl)
			}
			return
		}
		if (current.overlayId) {
			writeUrl(current, 'replace')
		}
	}, [addressable, searchParams, writeUrl])

	const open = useCallback<SettingsOverlayContextValue['open']>(
		(overlayId, target = {}) => {
			const next: State = { overlayId, target }
			setFormModified(false)
			setState(next)
			writeUrl(next, stateRef.current.overlayId ? 'replace' : 'push')
		},
		[writeUrl]
	)

	const close = useCallback(() => {
		setFormModified(false)
		setState(CLOSED)
		writeUrl(CLOSED, 'replace')
	}, [writeUrl])

	const setTarget = useCallback<SettingsOverlayContextValue['setTarget']>(
		(target) => {
			const current = stateRef.current
			if (!current.overlayId) {
				return
			}
			const next: State = { overlayId: current.overlayId, target }
			setFormModified(false)
			setState(next)
			writeUrl(next, 'replace')
		},
		[writeUrl]
	)

	/**
	 * The list's own query, kept beside the target. Only meaningful while a list is shown, so a
	 * target with a document id drops it; a filter change replaces rather than pushes, so the back
	 * button still closes the panel in one step.
	 */
	const setListQuery = useCallback<SettingsOverlayContextValue['setListQuery']>(
		(query) => {
			const current = stateRef.current
			if (!current.overlayId || current.target.id) {
				return
			}
			const { query: _previous, ...rest } = current.target
			// Payload's filter builder edits its condition objects in place and then hands the same
			// objects over. Held by reference, the stored query would already contain the change by
			// the time it arrives, and the "nothing changed" check below would swallow every edit
			// after the first. A deep copy is ours alone; `undefined` values survive it, which JSON
			// would not, and an unfinished condition must stay in memory exactly as the builder
			// left it.
			const copy = query ? structuredClone(query) : undefined
			const next: State = {
				overlayId: current.overlayId,
				target: { ...rest, ...(copy ? { query: copy } : {}) },
			}
			if (sameState(current, next)) {
				return
			}
			setState(next)
			writeUrl(next, 'replace')
		},
		[writeUrl]
	)

	const guard = useCallback<SettingsOverlayContextValue['guard']>(
		(action) => {
			if (!formModified) {
				action()
				return
			}
			pendingAction.current = action
			openModal(DISCARD_SLUG)
		},
		[formModified, openModal]
	)

	const toggle = useCallback<SettingsOverlayContextValue['toggle']>(
		(overlayId, target) => {
			if (stateRef.current.overlayId === overlayId) {
				guard(close)
				return
			}
			open(overlayId, target)
		},
		[close, guard, open]
	)

	const value = useMemo<SettingsOverlayContextValue>(
		() => ({
			activeOverlayId: state.overlayId,
			close,
			discardSlug: DISCARD_SLUG,
			formModified,
			guard,
			icons,
			isOpen: (overlayId) => state.overlayId === overlayId,
			lazyTransport,
			manifests,
			open,
			overlays,
			panelSlug: panelSlugFor,
			rendered,
			setFormModified,
			setListQuery,
			setTarget,
			target: state.target,
			toggle,
		}),
		[
			close,
			formModified,
			guard,
			icons,
			lazyTransport,
			manifests,
			open,
			overlays,
			rendered,
			setListQuery,
			setTarget,
			state.overlayId,
			state.target,
			toggle,
		]
	)

	return (
		<QueryClientProvider client={queryClient}>
			<InternalBadgeProvider manifests={manifests}>
				<SettingsOverlayContext value={value}>
					{children}
					{overlays.map((overlay) => (
						<SettingsPanel key={overlay.id} overlay={overlay} slots={slots?.[overlay.id]} />
					))}
					<ConfirmationModal
						body={t(keys.discardBody)}
						confirmLabel={t(keys.discardConfirm)}
						heading={t(keys.discardHeading)}
						modalSlug={DISCARD_SLUG}
						onCancel={() => {
							pendingAction.current = null
						}}
						onConfirm={() => {
							const action = pendingAction.current
							pendingAction.current = null
							setFormModified(false)
							action?.()
						}}
					/>
				</SettingsOverlayContext>
			</InternalBadgeProvider>
		</QueryClientProvider>
	)
}
