'use client'

import { Button, useDrawerSlug, useModal } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'
import { useState } from 'react'

import { toPreviewFile } from '../../shared/types'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { PreviewDrawer } from '../PreviewDrawer/PreviewDrawer'
import { PreviewIcon } from './PreviewIcon'
import './controls.css'

/**
 * List view cell: the same subtle button as the edit view's, small, opening
 * the row's file in a drawer. The column is appended last, so it never sits
 * inside the row's link to the document.
 *
 * The drawer mounts on the first click, not with the cell, so a page of rows
 * does not carry a hidden drawer per row. Opening the modal first and mounting
 * after is safe: the drawer reads its open state on mount.
 */
export const DocumentPreviewCell = ({ collectionSlug, rowData }: DefaultCellComponentProps) => {
	const { t } = useTranslation()
	const { openModal } = useModal()
	const slug = useDrawerSlug(`document-preview-${String(rowData?.id ?? '')}`)
	const [requested, setRequested] = useState(false)
	const file = toPreviewFile(rowData)

	if (!file) {
		return null
	}
	return (
		<>
			<Button
				aria-label={t(keys.previewFile, { filename: file.filename })}
				buttonStyle="subtle"
				icon={<PreviewIcon />}
				iconPosition="left"
				iconStyle="none"
				margin={false}
				onClick={() => {
					setRequested(true)
					openModal(slug)
				}}
				size="small"
			>
				{t(keys.preview)}
			</Button>
			{requested ? (
				<PreviewDrawer
					collection={collectionSlug}
					doc={rowData}
					slug={slug}
					title={file.filename}
				/>
			) : null}
		</>
	)
}
