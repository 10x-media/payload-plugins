'use client'

import type { ReactNode } from 'react'

import type { DocumentPreviewViewerProps } from '../shared/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { InfoCard } from './InfoCard'
import type { FileContentState } from './useFileContent'

/** The neutral placeholder while a viewer chunk or its file is loading. */
export const PreviewLoading = () => {
	const { t } = useTranslation()
	return (
		<div aria-busy="true" className="document-preview-loading" role="status">
			<span className="document-preview-loading__spinner" />
			<span>{t(keys.loading)}</span>
		</div>
	)
}

/**
 * Render a fetched file's content, or the shared loading, too-large and error
 * states. Errors are logged so the card can stay short.
 */
export const WithFileContent = <K extends 'arrayBuffer' | 'text'>({
	children,
	file,
	state,
}: {
	children: (content: K extends 'text' ? string : ArrayBuffer) => ReactNode
	file: DocumentPreviewViewerProps
	state: FileContentState<K>
}) => {
	if (state.status === 'loading') {
		return <PreviewLoading />
	}
	if (state.status === 'tooLarge') {
		return (
			<InfoCard
				filename={file.filename}
				filesize={state.size}
				mimeType={file.mimeType}
				reason="tooLarge"
			/>
		)
	}
	if (state.status === 'error') {
		console.error(`[document-preview] could not load ${file.url}`, state.error)
		return (
			<InfoCard
				filename={file.filename}
				filesize={file.filesize}
				mimeType={file.mimeType}
				reason="failed"
			/>
		)
	}
	return children(state.content)
}
