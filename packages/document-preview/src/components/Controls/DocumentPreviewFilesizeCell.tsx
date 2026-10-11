'use client'

import type { DefaultCellComponentProps } from 'payload'
import { formatFilesize } from 'payload/shared'

/** List view cell for `filesize`: `1.2 MB` instead of Payload's raw byte count. */
export const DocumentPreviewFilesizeCell = ({ cellData }: DefaultCellComponentProps) =>
	typeof cellData === 'number' ? <span>{formatFilesize(cellData)}</span> : null
