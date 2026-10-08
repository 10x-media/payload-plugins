'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { type CustomFileIcon, createFileIconSet, type FileIconSet } from '../../shared/fileIcons'
import type { ViewerMap } from '../../shared/resolveViewer'
import type { DocumentPreviewViewer } from '../../shared/types'

type ViewerOverridesContext = {
	collections: Record<string, ViewerMap<DocumentPreviewViewer>>
	icons: FileIconSet
	viewers: ViewerMap<DocumentPreviewViewer>
}

const EMPTY: ViewerOverridesContext = { collections: {}, icons: createFileIconSet(), viewers: {} }

const Context = createContext<ViewerOverridesContext>(EMPTY)

export type DocumentPreviewProviderProps = {
	children?: ReactNode
	/** Host viewers per collection slug. */
	collections?: Record<string, ViewerMap<DocumentPreviewViewer>>
	/** Host file icons, as the plugin resolved them. */
	fileIcons?: CustomFileIcon[]
	/** Host viewers for every collection. */
	viewers?: ViewerMap<DocumentPreviewViewer>
}

/**
 * Client half of the admin-wide provider: hands the host's viewer overrides to
 * every preview below it. Without it previews still work, with the built-in
 * viewers only.
 */
export const DocumentPreviewProvider = ({
	children,
	collections,
	fileIcons,
	viewers,
}: DocumentPreviewProviderProps) => {
	const value = useMemo(
		() => ({
			collections: collections ?? {},
			icons: createFileIconSet(fileIcons),
			viewers: viewers ?? {},
		}),
		[collections, fileIcons, viewers]
	)
	return <Context value={value}>{children}</Context>
}

/** The host viewer layers for `collection`, highest priority first. */
export const useViewerOverrides = (
	collection: string | undefined
): ReadonlyArray<undefined | ViewerMap<DocumentPreviewViewer>> => {
	const { collections, viewers } = useContext(Context)
	return useMemo(
		() => [collection ? collections[collection] : undefined, viewers],
		[collection, collections, viewers]
	)
}

/** The file icons in play, the host's included. */
export const useFileIcons = (): FileIconSet => useContext(Context).icons
