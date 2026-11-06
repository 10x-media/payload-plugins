'use client'

import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	ListDrawerContextProvider,
	toast,
	useAuth,
	useConfig,
	useModal,
	useServerFunctions,
} from '@payloadcms/ui'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListQuery } from 'payload'
import type React from 'react'
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo } from 'react'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { listQuery, overlayKeys } from '../queries'
import { ListSkeleton } from '../skeletons'

/**
 * Payload's list view in drawer mode, hosted in the pane.
 *
 * Passing the panel's slug as `drawerSlug` is what flips the list into drawer mode: row clicks
 * call `onSelect` instead of navigating, the query goes through `onQueryChange` instead of the
 * URL, and "create new" renders whatever toggler we supply.
 *
 * A cached render shows at once and is revalidated in the background; a filter change keeps the
 * previous rows on screen until the next ones land; a save or delete in the document pane
 * invalidates it.
 */
export const ListPane: React.FC<{
	collectionSlug: string
	onCreate: () => void
	/** Filters, search, sort, page and limit changed inside the list; the owner keeps them. */
	onQueryChange: (query: ListQuery | undefined) => void
	onSelectDocument: (id: string) => void
	panelSlug: string
	/** The query to render with, from the URL; `undefined` is the collection's default list. */
	query?: ListQuery
}> = ({ collectionSlug, onCreate, onQueryChange, onSelectDocument, panelSlug, query }) => {
	const { serverFunction } = useServerFunctions()
	const { getEntityConfig } = useConfig()
	const { permissions } = useAuth()
	const { closeModal, modalState } = useModal()
	const queryClient = useQueryClient()
	const { i18n, t } = useTranslation()

	const { data, error, isPending } = useQuery({
		...listQuery(serverFunction, { collectionSlug, panelSlug, query }),
		placeholderData: keepPreviousData,
	})

	// The list is a server-rendered tree, and on TanStack Start a fresh one suspends as it mounts
	// (see `DocumentPane`). The first one shows the skeleton below; every later one is deferred, so
	// the list in view stays until the next is ready rather than giving way to a fallback, which
	// would also drop focus from its search box between two keystrokes.
	const list = useDeferredValue(data)

	useEffect(() => {
		if (error) {
			toast.error(error instanceof Error ? error.message : t(keys.loadFailed))
		}
	}, [error, t])

	const collection = getEntityConfig({ collectionSlug })
	const canCreate = permissions?.collections?.[collectionSlug]?.create === true
	const createSlug = `${panelSlug}__create-${collectionSlug}`

	const refresh = useCallback(async () => {
		await queryClient.invalidateQueries({ queryKey: overlayKeys.lists(collectionSlug) })
	}, [collectionSlug, queryClient])

	// The empty state's "create" button opens `createNewDrawerSlug` as a modal. There is no such
	// modal here; watch the slug flip open, close it again, and switch the pane to the create form.
	useEffect(() => {
		if (modalState[createSlug]?.isOpen) {
			closeModal(createSlug)
			onCreate()
		}
	}, [closeModal, createSlug, modalState, onCreate])

	const CreateButton = useMemo(
		() =>
			function SettingsOverlayCreateButton({
				buttonStyle,
				children,
				className,
			}: {
				buttonStyle?: React.ComponentProps<typeof Button>['buttonStyle']
				children?: React.ReactNode
				className?: string
			}) {
				// Payload's own toggler renders a `Button` when the list asks for a style (its header
				// asks for `secondary`) and a bare button otherwise; this one follows it, with the
				// same `doc-drawer__toggler` class, and switches the pane instead of opening a drawer.
				const togglerClass = [className, 'doc-drawer__toggler'].filter(Boolean).join(' ')
				if (buttonStyle) {
					return (
						<Button buttonStyle={buttonStyle} className={togglerClass} onClick={onCreate}>
							{children}
						</Button>
					)
				}
				return (
					<button className={togglerClass} onClick={onCreate} type="button">
						{children}
					</button>
				)
			},
		[onCreate]
	)

	if (isPending) {
		return <ListSkeleton />
	}
	if (error || data === null) {
		return <p className="settings-overlay__empty">{t(keys.loadFailed)}</p>
	}

	return (
		<ListDrawerContextProvider
			allowCreate={canCreate}
			createNewDrawerSlug={createSlug}
			DocumentDrawerToggler={CreateButton as never}
			drawerSlug={panelSlug}
			enabledCollections={[collectionSlug as never]}
			onQueryChange={onQueryChange}
			onSelect={({ doc }) => {
				onSelectDocument(String(doc.id))
			}}
			refresh={refresh}
			selectedOption={{
				label: getTranslation(collection?.labels?.plural ?? collectionSlug, i18n),
				value: collectionSlug as never,
			}}
		>
			<Suspense fallback={<ListSkeleton />}>{list}</Suspense>
		</ListDrawerContextProvider>
	)
}
