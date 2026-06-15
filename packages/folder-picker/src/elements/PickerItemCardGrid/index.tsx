'use client'

import { useTranslation } from '@payloadcms/ui'
import type { FolderOrDocument } from 'payload/shared'
import React from 'react'

import { useFolderPicker } from '../../providers/FolderPickerContext/index'
import { PickerFileCard } from '../PickerFileCard/index'
import './index.scss'

const baseClass = 'item-card-grid'

type Props = {
	readonly folderCollectionSlug: string
	readonly onFileClick: (item: FolderOrDocument) => void
	readonly onFolderClick: (item: FolderOrDocument) => void
}

export function PickerItemCardGrid({ folderCollectionSlug, onFileClick, onFolderClick }: Props) {
	const {
		filteredDocuments: documents,
		filteredSubfolders: subfolders,
		selectedItemKeys,
	} = useFolderPicker()
	const { t } = useTranslation()

	const showLabels = subfolders.length > 0 && documents.length > 0

	return (
		<div className={`${baseClass}__sections`}>
			{subfolders.length > 0 && (
				<div className={`${baseClass}__section`}>
					{showLabels && <p className={`${baseClass}__title`}>{t('folder:folders')}</p>}
					<div className={baseClass}>
						{subfolders.map((item) => (
							<PickerFileCard
								isSelected={selectedItemKeys.has(item.itemKey)}
								item={item}
								key={item.itemKey}
								onClick={() => onFolderClick(item)}
								type="folder"
							/>
						))}
					</div>
				</div>
			)}
			{documents.length > 0 && (
				<div className={`${baseClass}__section`}>
					{showLabels && <p className={`${baseClass}__title`}>{t('general:documents')}</p>}
					<div className={baseClass}>
						{documents.map((item) => (
							<PickerFileCard
								isSelected={selectedItemKeys.has(item.itemKey)}
								item={item}
								key={item.itemKey}
								onClick={() => onFileClick(item)}
								type="file"
							/>
						))}
					</div>
				</div>
			)}
		</div>
	)
}
