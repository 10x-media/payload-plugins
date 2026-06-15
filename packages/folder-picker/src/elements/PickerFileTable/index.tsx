//biome-ignore-all lint/a11y/noSvgWithoutTitle: Just icons
'use client'

import { useConfig, useTranslation } from '@payloadcms/ui'
import type { FolderOrDocument } from 'payload/shared'
import { extractID } from 'payload/shared'
import React from 'react'
import { useFolderPicker } from '../../providers/FolderPickerContext/index'
import { getTranslation } from '../../utilities/getTranslation'
import { PickerSimpleTable, PickerTableHeader } from '../PickerSimpleTable/index'
import { PickerTableRow } from '../PickerTableRow/index'
import './index.scss'

const baseClass = 'folder-file-table'

// Inline SVGs — not exported from @payloadcms/ui
function FolderIcon() {
	return (
		<svg
			className="icon icon--folder"
			fill="none"
			height="16"
			viewBox="0 0 16 16"
			width="16"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M13.3333 13.3333C13.6869 13.3333 14.026 13.1929 14.2761 12.9428C14.5261 12.6928 14.6666 12.3536 14.6666 12V5.33333C14.6666 4.97971 14.5261 4.64057 14.2761 4.39052C14.026 4.14048 13.6869 4 13.3333 4H8.06659C7.84359 4.00219 7.62362 3.94841 7.42679 3.84359C7.22996 3.73877 7.06256 3.58625 6.93992 3.4L6.39992 2.6C6.27851 2.41565 6.11323 2.26432 5.91892 2.1596C5.7246 2.05488 5.50732 2.00004 5.28659 2H2.66659C2.31296 2 1.97382 2.14048 1.72378 2.39052C1.47373 2.64057 1.33325 2.97971 1.33325 3.33333V12C1.33325 12.3536 1.47373 12.6928 1.72378 12.9428C1.97382 13.1929 2.31296 13.3333 2.66659 13.3333H13.3333Z"
				fill="currentColor"
			/>
		</svg>
	)
}

function DocumentIcon() {
	return (
		<svg
			className="icon icon--document"
			fill="none"
			height="16"
			viewBox="0 0 16 16"
			width="16"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				clipRule="evenodd"
				d="M3.5 1C2.94772 1 2.5 1.44772 2.5 2V14C2.5 14.5523 2.94771 15 3.5 15H12.5C13.0523 15 13.5 14.5523 13.5 14V4.41421C13.5 4.149 13.3946 3.89464 13.2071 3.70711L10.7929 1.29289C10.6054 1.10536 10.351 1 10.0858 1H3.5ZM5 5.5C5 5.22386 5.22386 5 5.5 5H10.5C10.7761 5 11 5.22386 11 5.5C11 5.77614 10.7761 6 10.5 6H5.5C5.22386 6 5 5.77614 5 5.5ZM5 8.5C5 8.22386 5.22386 8 5.5 8H10.5C10.7761 8 11 8.22386 11 8.5C11 8.77614 10.7761 9 10.5 9H5.5C5.22386 9 5 8.77614 5 8.5ZM5 11.5C5 11.2239 5.22386 11 5.5 11H10.5C10.7761 11 11 11.2239 11 11.5C11 11.7761 10.7761 12 10.5 12H5.5C5.22386 12 5 11.7761 5 11.5Z"
				fill="currentColor"
				fillRule="evenodd"
			/>
		</svg>
	)
}

type Props = {
	readonly folderCollectionSlug: string
	readonly hasMany?: boolean
	readonly onFileClick: (item: FolderOrDocument) => void
	readonly onFolderClick: (item: FolderOrDocument) => void
}

export function PickerFileTable({
	folderCollectionSlug,
	hasMany,
	onFileClick,
	onFolderClick,
}: Props) {
	const {
		filteredDocuments: documents,
		filteredSubfolders: subfolders,
		selectedItemKeys,
	} = useFolderPicker()
	const { config } = useConfig()
	const { i18n, t } = useTranslation()

	const [relationToMap] = React.useState(() => {
		const map: Record<string, { plural: string; singular: string }> = {}
		config.collections.forEach((collection) => {
			map[collection.slug] = {
				plural: getTranslation(collection.labels?.plural, i18n),
				singular: getTranslation(collection.labels?.singular, i18n),
			}
		})
		return map
	})

	const columns = [
		{ name: 'name', label: t('general:name') },
		{ name: 'createdAt', label: t('general:createdAt') },
		{ name: 'updatedAt', label: t('general:updatedAt') },
		{ name: 'type', label: t('version:type') },
	]

	const formatItemDate = (dateStr: string) => {
		if (!dateStr) return '—'
		try {
			return new Intl.DateTimeFormat(i18n.language, {
				day: '2-digit',
				month: 'short',
				year: 'numeric',
			}).format(new Date(dateStr))
		} catch {
			return dateStr
		}
	}

	return (
		<PickerSimpleTable
			headerCells={columns.map(({ name, label }) => (
				<PickerTableHeader key={name}>{label}</PickerTableHeader>
			))}
			tableRows={[
				...subfolders.map((subfolder, rowIndex) => {
					const { itemKey, relationTo, value } = subfolder
					const subfolderID = extractID(value)

					return (
						<PickerTableRow
							columns={columns.map(({ name }, index) => {
								let cellValue: React.ReactNode = '—'

								if (name === 'name' && value._folderOrDocumentTitle !== undefined) {
									cellValue = value._folderOrDocumentTitle
								}

								if ((name === 'createdAt' || name === 'updatedAt') && value[name]) {
									cellValue = formatItemDate(value[name] as string)
								}

								if (name === 'type') {
									cellValue = (
										<>
											{relationToMap[relationTo]?.singular || relationTo}
											{Array.isArray(subfolder.value?.folderType)
												? subfolder.value.folderType.reduce(
														(acc: string, slug: string, i: number) => {
															if (i === 0) return ` — ${relationToMap[slug]?.plural || slug}`
															return `${acc}, ${relationToMap[slug]?.plural || slug}`
														},
														''
													)
												: ''}
										</>
									)
								}

								if (index === 0) {
									return (
										<span className={`${baseClass}__cell-with-icon`} key={`${itemKey}-${name}`}>
											<FolderIcon />
											{cellValue}
										</span>
									)
								}
								return cellValue
							})}
							isFocused={false}
							isSelected={selectedItemKeys.has(itemKey)}
							isSelecting={selectedItemKeys.size > 0}
							itemKey={`${rowIndex}-${itemKey}`}
							// biome-ignore lint/suspicious/noArrayIndexKey: No harm in using index as key here
							key={`${rowIndex}-${itemKey}`}
							onClick={() => onFolderClick(subfolder)}
						/>
					)
				}),

				...documents.map((document, unadjustedIndex) => {
					const { itemKey, relationTo, value } = document
					const documentID = extractID(value)
					const rowIndex = unadjustedIndex + subfolders.length

					return (
						<PickerTableRow
							columns={columns.map(({ name }, index) => {
								let cellValue: React.ReactNode = '—'

								if (name === 'name' && value._folderOrDocumentTitle !== undefined) {
									cellValue = value._folderOrDocumentTitle
								}

								if ((name === 'createdAt' || name === 'updatedAt') && value[name]) {
									cellValue = formatItemDate(value[name] as string)
								}

								if (name === 'type') {
									cellValue = relationToMap[relationTo]?.singular || relationTo
								}

								if (index === 0) {
									return (
										<span className={`${baseClass}__cell-with-icon`} key={`${itemKey}-${name}`}>
											<DocumentIcon />
											{cellValue}
										</span>
									)
								}
								return cellValue
							})}
							isFocused={false}
							isSelected={selectedItemKeys.has(itemKey)}
							isSelecting={selectedItemKeys.size > 0}
							itemKey={`${rowIndex}-${itemKey}`}
							key={`${rowIndex}-${itemKey}`}
							onClick={() => onFileClick(document)}
						/>
					)
				}),
			]}
		/>
	)
}
