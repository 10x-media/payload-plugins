'use client'

import { useDocumentInfo } from '@payloadcms/ui'

import { DocumentPreview } from '../DocumentPreview/DocumentPreview'
import './controls.css'

/**
 * The inline preview, rendered by a ui field placed first in the collection's
 * fields, so it sits between the upload area and the fields. Shows the saved
 * file, and stays inert until clicked so the wheel keeps scrolling the form.
 */
export const DocumentPreviewInlineField = () => {
	const { collectionSlug, data } = useDocumentInfo()
	return (
		<DocumentPreview
			className="document-preview-inline"
			collection={collectionSlug}
			doc={data}
			interactOnClick
		/>
	)
}
