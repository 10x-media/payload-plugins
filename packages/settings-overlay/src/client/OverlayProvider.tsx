'use client'

import {
	ConfirmationModal,
	useAuth,
	useModal,
	usePathname,
	useRouter,
	useSearchParams,
} from '@payloadcms/ui'
import { QueryClientProvider } from '@tanstack/react-query'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DISCARD_SLUG, panelSlugFor, SEARCH_PARAM } from '../plugin/constants'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ClientOverlay, Manifest } from '../types'
import { InternalBadgeProvider } from './badges'
import { SettingsOverlayContext, type SettingsOverlayContextValue } from './context'
import { SettingsPanel } from './Overlay'
import { CLOSED, parseParam, type State, sameState } from './panelState'
import { createOverlayQueryClient } from './queries'
import { readerKey } from './readerKey'
import type { OverlaySlots } from './slots'

export type SettingsOverlayClientProps = {
	children?: React.ReactNode
	/** Server-rendered icons, keyed by `overlayId` and `overlayId/itemSlug`. */
	icons: Record<string, React.ReactNode>
	lazyTransport: 'server-function' | 'widget'
	manifests: Record<string, Manifest>
	overlays: ClientOverlay[]
	/** `readerKey` of the user the server rendered this for, `null` on the login screen. */
	reader: null | string
	/** Server-rendered eager `component` items, keyed by `overlayId/itemSlug`. */
	rendered: Record<string, React.ReactNode>
	slots?: Record<string, OverlaySlots>
}

/**
 * Owns which overlay is open and what it points at, and mounts each panel once.
 *
 * The panel's state lives here and nowhere else. A link can open it: the page's URL is read for
 * `?settings=<overlay>/<item>[/<id>]` when the admin loads and whenever a navigation brings a new
 * value, so `/admin?settings=system/tags` works from a bookmark, an email or a `<Link>`. Nothing
 * is ever written back while the panel is in use, so it adds no history entries and the back
 * button leaves the page, as it does over Payload's own drawers. Closing a panel that a link
 * opened takes the parameter out of the address, so a reload does not bring it back.
 */
export const SettingsOverlayClient: React.FC<SettingsOverlayClientProps> = ({
	children,
	icons,
	lazyTransport,
	manifests,
	overlays,
	reader,
	rendered,
	slots,
}) => {
	const searchParams = useSearchParams()
	const pathname = usePathname()
	const router = useRouter()
	const { openModal } = useModal()
	const { user } = useAuth()
	const { t } = useTranslation()
	const [queryClient] = useState(createOverlayQueryClient)

	const addressable = useMemo(
		() => new Set(overlays.filter((overlay) => overlay.addressable).map((overlay) => overlay.id)),
		[overlays]
	)

	/** The state a `settings` value names, or `CLOSED` for no value or a panel links cannot open. */
	const fromLink = useCallback(
		(value: null | string): State => {
			const linked = parseParam(value)
			return linked.overlayId && addressable.has(linked.overlayId) ? linked : CLOSED
		},
		[addressable]
	)

	const link = searchParams.get(SEARCH_PARAM)
	const [state, setState] = useState<State>(() => fromLink(link))
	const [formModified, setFormModified] = useState(false)
	const pendingAction = useRef<null | (() => void)>(null)

	// Signing in and out are client navigations, which leave the root layout, and with it the
	// server half of this provider, as it was rendered for the previous reader. Refresh once per
	// reader so the rail is computed for the one now signed in.
	const currentReader = readerKey(user)
	const refreshedFor = useRef<null | string | undefined>(undefined)
	useEffect(() => {
		if (currentReader === reader) {
			refreshedFor.current = undefined
			return
		}
		if (refreshedFor.current === currentReader) {
			return
		}
		refreshedFor.current = currentReader
		router.refresh()
	}, [currentReader, reader, router])

	// A navigation that brings a new `settings` value is a link to a panel: follow it. The value
	// the page loaded with is already the initial state, and the same value seen again (a list
	// behind the panel rewriting its own query) is not a new link.
	const followedLink = useRef(link)
	useEffect(() => {
		if (link === followedLink.current) {
			return
		}
		followedLink.current = link
		const linked = fromLink(link)
		if (linked.overlayId) {
			setFormModified(false)
			setState(linked)
		}
	}, [fromLink, link])

	const open = useCallback<SettingsOverlayContextValue['open']>((overlayId, target = {}) => {
		setFormModified(false)
		setState({ overlayId, target })
	}, [])

	/**
	 * Closes the panel. When the address still names a panel, the link that opened it, the
	 * parameter goes too, through the router so that TanStack Router's own view of the URL stays
	 * true; otherwise a reload would open the panel again.
	 */
	const close = useCallback(() => {
		setFormModified(false)
		setState(CLOSED)
		const params = new URLSearchParams(window.location.search)
		if (!params.has(SEARCH_PARAM)) {
			return
		}
		params.delete(SEARCH_PARAM)
		const query = params.toString()
		followedLink.current = null
		void router.replace(`${pathname}${query ? `?${query}` : ''}${window.location.hash}`, {
			scroll: false,
		})
	}, [pathname, router])

	/** Leaves the panel for a page, which is what selecting a `link` row does. */
	const navigate = useCallback<SettingsOverlayContextValue['navigate']>(
		(url) => {
			setFormModified(false)
			setState(CLOSED)
			router.push(url)
		},
		[router]
	)

	const setTarget = useCallback<SettingsOverlayContextValue['setTarget']>((target) => {
		setFormModified(false)
		setState((current) => (current.overlayId ? { overlayId: current.overlayId, target } : current))
	}, [])

	/**
	 * The list's own query, kept beside the target. Only meaningful while a list is shown, so a
	 * target with a document id ignores it.
	 */
	const setListQuery = useCallback<SettingsOverlayContextValue['setListQuery']>((query) => {
		// Payload's filter builder edits its condition objects in place and then hands the same
		// objects over. Held by reference, the stored query would already contain the change by the
		// time it arrives, and the "nothing changed" check below would swallow every edit after the
		// first. A deep copy is ours alone, and keeps an unfinished condition exactly as the builder
		// left it.
		const copy = query ? structuredClone(query) : undefined
		setState((current) => {
			if (!current.overlayId || current.target.id) {
				return current
			}
			const { query: _previous, ...rest } = current.target
			const next: State = {
				overlayId: current.overlayId,
				target: { ...rest, ...(copy ? { query: copy } : {}) },
			}
			return sameState(current, next) ? current : next
		})
	}, [])

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
			if (state.overlayId === overlayId) {
				guard(close)
				return
			}
			open(overlayId, target)
		},
		[close, guard, open, state.overlayId]
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
