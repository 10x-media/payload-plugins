// biome-ignore-all lint/a11y/useSemanticElements: I just porting this from old repo. Feel free to improve
// biome-ignore-all lint/a11y/noSvgWithoutTitle: Just icons
// biome-ignore-all lint/suspicious/noExplicitAny: same
'use client'

import { Thumbnail, useConfig, useTranslation } from '@payloadcms/ui'
import type { FolderOrDocument } from 'payload/shared'
import React from 'react'

import './index.scss'
import { getTranslation } from '../../utilities/getTranslation'

const baseClass = 'folder-file-card'

// Inline — not exported from @payloadcms/ui
function FolderIcon() {
	return (
		<svg
			className="icon icon--folder colored-folder-icon"
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

function AssignedCollections({ folderType }: { folderType: string[] }) {
	const { config } = useConfig()
	const { i18n } = useTranslation()

	const collectionsDisplayText = React.useMemo(
		() =>
			folderType.reduce<string[]>((acc, slug) => {
				const col = config.collections?.find((c) => c.slug === slug)
				if (col) acc.push(getTranslation(col.labels.plural, i18n))
				return acc
			}, []),
		[folderType, config.collections, i18n]
	)

	return (
		<p className={`${baseClass}__assigned-collections`}>
			{collectionsDisplayText.map((label, i) => (
				<span key={label}>
					{label}
					{i < folderType.length - 1 ? ', ' : ''}
				</span>
			))}
		</p>
	)
}

type Props = {
	readonly disabled?: boolean
	readonly isFocused?: boolean
	readonly isSelected?: boolean
	readonly item: FolderOrDocument
	readonly onClick?: (e: React.MouseEvent) => void
	readonly onKeyDown?: (e: React.KeyboardEvent) => void
	readonly type: 'file' | 'folder'
}

export function PickerFileCard({
	disabled = false,
	isFocused = false,
	isSelected = false,
	item,
	onClick,
	onKeyDown,
}: Props) {
	const { value, itemKey } = item
	const isFolder = !!(value.folderType && !value.url && !value.filename)
	const type = isFolder ? 'folder' : 'file'
	const previewUrl =
		((value as any).thumbnailURL as string | undefined) || (value.url as string | undefined)
	const title = (value._folderOrDocumentTitle as string) || String(value.id)
	const folderType = (value.folderType as string[]) || []

	const ref = React.useRef<HTMLDivElement>(null)

	React.useEffect(() => {
		if (isFocused && ref.current) ref.current.focus()
		else if (!isFocused && ref.current) ref.current.blur()
	}, [isFocused])

	return (
		<div
			className={[
				baseClass,
				isSelected && `${baseClass}--selected`,
				disabled && `${baseClass}--disabled`,
				isFocused && `${baseClass}--focused`,
				`${baseClass}--${type}`,
			]
				.filter(Boolean)
				.join(' ')}
			key={itemKey}
			onClick={disabled ? undefined : onClick}
			onKeyDown={disabled ? undefined : onKeyDown}
			ref={ref}
			role="button"
			tabIndex={disabled ? undefined : 0}
		>
			{type === 'file' && (
				<div className={`${baseClass}__preview-area`}>
					{previewUrl ? <Thumbnail fileSrc={previewUrl} /> : <DocumentIcon />}
				</div>
			)}

			<div className={`${baseClass}__titlebar-area`}>
				<div className={`${baseClass}__icon-wrap`}>
					{type === 'file' ? <DocumentIcon /> : <FolderIcon />}
				</div>
				<div className={`${baseClass}__titlebar-labels`}>
					<p className={`${baseClass}__name`} title={title}>
						<span>{title}</span>
					</p>
					{folderType.length > 0 && <AssignedCollections folderType={folderType} />}
				</div>
			</div>
		</div>
	)
}
