// biome-ignore-all lint/suspicious/noExplicitAny: todo - handle every any in this file

'use client'

import { useConfig, useServerFunctions } from '@payloadcms/ui'
import type { FolderSortKeys } from 'payload'
import type { FolderBreadcrumb, FolderDocumentItemKey, FolderOrDocument } from 'payload/shared'
import type React from 'react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

export type FolderPickerContextValue = {
	breadcrumbs: FolderBreadcrumb[]
	clearSelections: () => void
	documents: FolderOrDocument[]
	filteredDocuments: FolderOrDocument[]
	filteredSubfolders: FolderOrDocument[]
	folderID: number | string | undefined
	FolderResultsComponent: React.ReactNode
	isLoading: boolean
	localSearch: string
	navigateToFolder: (id: number | string | undefined) => Promise<void>
	refetch: (query?: { search?: string; sort?: FolderSortKeys }) => Promise<void>
	search: string
	selectDocument: (item: FolderOrDocument) => void
	selectedItemKeys: Set<FolderDocumentItemKey>
	setLocalSearch: (search: string) => void
	setSearch: (search: string) => void
	sort: FolderSortKeys
	subfolders: FolderOrDocument[]
	toggleSelectDocument: (item: FolderOrDocument) => void
}

export type FolderPickerProviderProps = {
	readonly children: React.ReactNode
	readonly collectionSlugs: string[]
	readonly excludeIds?: Set<string | number>
}

const Context = createContext<FolderPickerContextValue | undefined>(undefined)

export function FolderPickerProvider({
	children,
	collectionSlugs,
	excludeIds,
}: FolderPickerProviderProps) {
	const { config } = useConfig()
	const { getFolderResultsComponentAndData } = useServerFunctions()

	const folderCollectionSlug =
		typeof config.folders === 'object'
			? (config.folders.slug ?? 'payload-folders')
			: 'payload-folders'

	const [folderID, setFolderID] = useState<number | string | undefined>(undefined)
	const [breadcrumbs, setBreadcrumbs] = useState<FolderBreadcrumb[]>([])
	const [documents, setDocuments] = useState<FolderOrDocument[]>([])
	const [subfolders, setSubfolders] = useState<FolderOrDocument[]>([])
	const [FolderResultsComponent, setFolderResultsComponent] = useState<React.ReactNode>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [selectedItemKeys, setSelectedItemKeys] = useState<Set<FolderDocumentItemKey>>(
		() => new Set()
	)
	const [search, setSearch] = useState('')
	const [sort, setSort] = useState<FolderSortKeys>('name')
	const [localSearch, setLocalSearch] = useState('')

	const fetchCountRef = useRef(0)

	const fetchFolder = useCallback(
		async (args: {
			newFolderID: number | string | undefined
			newSearch?: string
			newSort?: FolderSortKeys
		}) => {
			const { newFolderID, newSearch = search, newSort = sort } = args
			const fetchId = ++fetchCountRef.current

			setIsLoading(true)
			try {
				const result = await getFolderResultsComponentAndData({
					browseByFolder: false,
					collectionsToDisplay: [folderCollectionSlug, ...collectionSlugs],
					displayAs: 'list',
					folderAssignedCollections: collectionSlugs,
					folderID: newFolderID,
					sort: newSort,
				})

				if (fetchId !== fetchCountRef.current) return

				if (result && !('message' in result) && !('errors' in result)) {
					setBreadcrumbs(result.breadcrumbs ?? [])
					const rawDocs = result.documents ?? []
					const filteredDocs = excludeIds?.size
						? rawDocs.filter((d) => {
								const id = (d.value as any)?.id
								return id == null || !excludeIds.has(id)
							})
						: rawDocs
					setDocuments(filteredDocs)
					setSubfolders(result.subfolders ?? [])
					setFolderResultsComponent(null)
				}
			} finally {
				if (fetchId === fetchCountRef.current) {
					setIsLoading(false)
				}
			}
		},
		[
			getFolderResultsComponentAndData,
			folderCollectionSlug,
			collectionSlugs,
			excludeIds,
			search,
			sort,
		]
	)

	const filteredDocuments = useMemo(() => {
		if (!localSearch) return documents
		const q = localSearch.toLowerCase()
		return documents.filter((d) => (d.value._folderOrDocumentTitle || '').toLowerCase().includes(q))
	}, [documents, localSearch])

	const filteredSubfolders = useMemo(() => {
		if (!localSearch) return subfolders
		const q = localSearch.toLowerCase()
		return subfolders.filter((d) =>
			(d.value._folderOrDocumentTitle || '').toLowerCase().includes(q)
		)
	}, [subfolders, localSearch])

	const navigateToFolder = useCallback(
		async (id: number | string | undefined) => {
			setFolderID(id)
			setSelectedItemKeys(new Set())
			setLocalSearch('')
			await fetchFolder({ newFolderID: id })
		},
		[fetchFolder]
	)

	const refetch = useCallback(
		async (query?: { search?: string; sort?: FolderSortKeys }) => {
			const newSearch = query?.search ?? search
			const newSort = query?.sort ?? sort
			if (query?.search !== undefined) setSearch(newSearch)
			if (query?.sort !== undefined) setSort(newSort)
			await fetchFolder({ newFolderID: folderID, newSearch, newSort })
		},
		[fetchFolder, folderID, search, sort]
	)

	const toggleSelectDocument = useCallback((item: FolderOrDocument) => {
		setSelectedItemKeys((prev) => {
			const next = new Set(prev)
			if (next.has(item.itemKey)) {
				next.delete(item.itemKey)
			} else {
				next.add(item.itemKey)
			}
			return next
		})
	}, [])

	// Replaces any existing selection with a single item (for hasMany=false)
	const selectDocument = useCallback((item: FolderOrDocument) => {
		setSelectedItemKeys(new Set([item.itemKey]))
	}, [])

	const clearSelections = useCallback(() => {
		setSelectedItemKeys(new Set())
	}, [])

	return (
		<Context
			value={{
				breadcrumbs,
				clearSelections,
				documents,
				filteredDocuments,
				filteredSubfolders,
				folderID,
				FolderResultsComponent,
				isLoading,
				localSearch,
				navigateToFolder,
				refetch,
				search,
				selectDocument,
				selectedItemKeys,
				setLocalSearch,
				setSearch,
				sort,
				subfolders,
				toggleSelectDocument,
			}}
		>
			{children}
		</Context>
	)
}

export function useFolderPicker(): FolderPickerContextValue {
	const context = useContext(Context)
	if (!context) {
		throw new Error('useFolderPicker must be used within FolderPickerProvider')
	}
	return context
}
