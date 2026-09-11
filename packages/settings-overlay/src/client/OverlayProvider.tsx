'use client'

import { ConfirmationModal, useModal } from '@payloadcms/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
 * pushState/replaceState into `useSearchParams`, and popstate carries the address back into the
 * state, so the back button moves the panel exactly as far as the URL moved.
 *
 * Whether a navigation is an entry of its own is the overlay's `history` option. The panel never
 * travels through the history itself: the browser does, and the panel follows the URL it lands on.
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
	const router = useRouter()
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

	const historyModes = useMemo(
		() => new Map(overlays.map((overlay) => [overlay.id, overlay.history])),
		[overlays]
	)

	/**
	 * Writes the panel's state into the URL.
	 *
	 * `'push'` is a navigation: a new entry, when the overlay it belongs to runs with
	 * `history: 'push'`. `'replace'` corrects the address without moving the reader: the list's
	 * query, the first row written back into a panel opened without one, a document that could not
	 * be shown giving way to its list.
	 *
	 * An address identical to the current one is never pushed, whatever the caller asked for. A
	 * second entry for the same URL is a back press that appears to do nothing.
	 */
	const writeUrl = useCallback(
		(next: State, mode: 'push' | 'replace', overlayId: null | string = next.overlayId) => {
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
			const moved = query !== new URLSearchParams(window.location.search).toString()
			if (
				mode === 'push' &&
				moved &&
				overlayId !== null &&
				historyModes.get(overlayId) === 'push'
			) {
				window.history.pushState(null, '', url)
			} else {
				window.history.replaceState(null, '', url)
			}
		},
		[addressable, historyModes, pathname]
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
			writeUrl(next, 'push')
		},
		[writeUrl]
	)

	/**
	 * Closing is a navigation like any other. Under `history: 'push'` it is an entry of its own, so
	 * the back button reopens the panel where the reader left it, as it would return them to a page
	 * they had left.
	 */
	const close = useCallback(() => {
		const closing = stateRef.current.overlayId
		setFormModified(false)
		setState(CLOSED)
		writeUrl(CLOSED, 'push', closing)
	}, [writeUrl])

	/**
	 * Leaves the panel for a page, which is what selecting a `link` row does.
	 *
	 * A push in either history mode, because the destination is a page. For an addressable overlay
	 * the entry being left keeps the panel's address, so the back button returns the reader to the
	 * panel exactly as they left it; a panel kept out of the URL has no address to return to.
	 */
	const navigate = useCallback<SettingsOverlayContextValue['navigate']>(
		(url) => {
			setFormModified(false)
			setState(CLOSED)
			router.push(url)
		},
		[router]
	)

	const setTarget = useCallback<SettingsOverlayContextValue['setTarget']>(
		(target, options) => {
			const current = stateRef.current
			if (!current.overlayId) {
				return
			}
			const next: State = { overlayId: current.overlayId, target }
			setFormModified(false)
			setState(next)
			writeUrl(next, options?.replace ? 'replace' : 'push')
		},
		[writeUrl]
	)

	/**
	 * The list's own query, kept beside the target. Only meaningful while a list is shown, so a
	 * target with a document id drops it. A filter change replaces rather than pushes, as Payload's
	 * own list does on a page, so the back button steps past a reader's filtering rather than
	 * through every keystroke of it.
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
			navigate,
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
			navigate,
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
