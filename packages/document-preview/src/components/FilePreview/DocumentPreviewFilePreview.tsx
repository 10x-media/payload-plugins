'use client'

import { useDocumentInfo } from '@payloadcms/ui'
import type { UploadFilePreviewClientProps } from 'payload'
import { useMemo } from 'react'

import { DocumentPreview } from '../DocumentPreview/DocumentPreview'
import './file-preview.css'

/**
 * The plugin's preview in the edit view's file panel, registered as the
 * collection's `upload.admin.components.filePreview`. Payload hands it the saved
 * file; the full document comes from the document info, so host viewers get the
 * same `doc` and `collection` as in the list drawer.
 */
export const DocumentPreviewFilePreview = ({
	filename,
	filesize,
	fileSrc,
	mimeType,
}: UploadFilePreviewClientProps) => {
	const { collectionSlug, data } = useDocumentInfo()
	const doc = useMemo(
		() => ({ filename, filesize, mimeType, url: fileSrc, ...data }),
		[data, filename, filesize, fileSrc, mimeType]
	)
	return (
		<DocumentPreview className="document-preview-panel" collection={collectionSlug} doc={doc} />
	)
}
