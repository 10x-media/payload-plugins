'use client'

// import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	Popup,
	PopupList,
	useConfig,
	useDocumentDrawer,
	useTranslation,
} from '@payloadcms/ui'
import type { ClientCollectionConfig } from 'payload'
import type { FolderOrDocument } from 'payload/shared'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { useFolderPicker } from '../../providers/FolderPickerContext/index'

// Separate component per collection — useDocumentDrawer requires a fixed collectionSlug at call site
function CollectionDrawer({
	collectionSlug,
	folderFieldName,
	folderID,
	isActive,
	onClose,
	onSave,
}: {
	collectionSlug: string
	folderFieldName: string
	folderID: number | string | undefined
	isActive: boolean
	onClose: () => void
	onSave: (doc: Record<string, unknown>) => void
}) {
	const [DocDrawer, , { closeDrawer, isDrawerOpen, openDrawer }] = useDocumentDrawer({
		collectionSlug,
	})

	useEffect(() => {
		if (isActive) openDrawer()
	}, [isActive, openDrawer])

	// Reset parent activeSlug when user closes drawer without saving
	useEffect(() => {
		if (!isDrawerOpen && isActive) onClose()
	}, [isDrawerOpen, isActive, onClose])

	return (
		<DocDrawer
			initialData={{ [folderFieldName]: folderID ?? null }}
			onSave={({ doc }) => {
				onSave(doc)
				closeDrawer()
			}}
			redirectAfterCreate={false}
		/>
	)
}

type Props = {
	readonly collectionSlugs: string[]
	readonly onCreated: (item: FolderOrDocument) => void
}

const baseClass = 'create-new-doc-button'

export function CreateNewDocButton({ collectionSlugs, onCreated }: Props) {
	const { config } = useConfig()
	const { i18n, t } = useTranslation()
	const { folderID } = useFolderPicker()

	const folderFieldName =
		typeof config.folders === 'object' ? (config.folders.fieldName ?? 'folder') : 'folder'

	const [activeSlug, setActiveSlug] = useState<string | undefined>()

	const enabledCollections = useMemo<ClientCollectionConfig[]>(
		() =>
			collectionSlugs.reduce<ClientCollectionConfig[]>((acc, slug) => {
				const col = config.collections?.find((c) => c.slug === slug)
				if (col) acc.push(col)
				return acc
			}, []),
		[collectionSlugs, config.collections]
	)

	const handleSave = useCallback(
		(collectionSlug: string, doc: Record<string, unknown>) => {
			const item: FolderOrDocument = {
				itemKey: `${collectionSlug}-${doc.id}`,
				relationTo: collectionSlug,
				value: {
					_folderOrDocumentTitle: (doc.title ?? doc.filename ?? String(doc.id)) as string,
					filename: doc.filename as string | undefined,
					folderType: (doc.folderType as string[]) ?? [],
					id: doc.id as number | string,
					mimeType: doc.mimeType as string | undefined,
					url: doc.url as string | undefined,
				},
			}
			onCreated(item)
		},
		[onCreated]
	)

	if (enabledCollections.length === 0) return null

	return (
		<>
			{enabledCollections.length === 1 ? (
				<Button
					buttonStyle="pill"
					icon="plus"
					onClick={() => setActiveSlug(enabledCollections[0]!.slug)}
					size="small"
					margin={false}
				>
					{t('general:createNew')}
				</Button>
			) : (
				<Popup
					button={
						<Button buttonStyle="pill" el="div" icon="chevron" size="small" margin={false}>
							{t('general:createNew')}
						</Button>
					}
					buttonType="default"
				>
					<PopupList.ButtonGroup>
						{enabledCollections.map((col) => (
							<PopupList.Button key={col.slug} onClick={() => setActiveSlug(col.slug)}>
								{
									// TODO : fix this
									// getTranslation(col.labels.singular, i18n)
									col.slug
								}
							</PopupList.Button>
						))}
					</PopupList.ButtonGroup>
				</Popup>
			)}

			{enabledCollections.map((col) => (
				<CollectionDrawer
					key={col.slug}
					collectionSlug={col.slug}
					folderFieldName={folderFieldName}
					folderID={folderID}
					isActive={activeSlug === col.slug}
					onClose={() => setActiveSlug(undefined)}
					onSave={(doc) => handleSave(col.slug, doc)}
				/>
			))}
		</>
	)
}
