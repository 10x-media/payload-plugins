'use client'

import { ChevronIcon, useTranslation } from '@payloadcms/ui'
import React from 'react'

import { useFolderPicker } from '../../providers/FolderPickerContext/index'
import './index.scss'

const baseClass = 'folderBreadcrumbs'

export function PickerBreadcrumbs() {
	const { breadcrumbs, navigateToFolder } = useFolderPicker()
	const { t } = useTranslation()

	const allCrumbs: { id: null | number | string; name: string; onClick?: () => void }[] = [
		{
			id: null,
			name: t('folder:folders'),
			onClick: () => void navigateToFolder(undefined),
		},
		...(breadcrumbs ?? []).map((crumb, i, arr) => ({
			id: crumb.id,
			name: crumb.name,
			// last crumb = current folder, not clickable
			onClick: i < arr.length - 1 ? () => void navigateToFolder(crumb.id!) : undefined,
		})),
	]

	return (
		<div className={baseClass}>
			{allCrumbs.map((crumb, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: No harm in using index as key here
				<div className={`${baseClass}__crumb`} key={index}>
					{crumb.onClick ? (
						<button
							className={`${baseClass}__crumb-item droppable-button`}
							onClick={crumb.onClick}
							type="button"
						>
							{crumb.name}
						</button>
					) : (
						<span className={`${baseClass}__crumb-item`}>{crumb.name}</span>
					)}
					{index !== allCrumbs.length - 1 && (
						<ChevronIcon className={`${baseClass}__crumb-chevron`} direction="right" />
					)}
				</div>
			))}
		</div>
	)
}
