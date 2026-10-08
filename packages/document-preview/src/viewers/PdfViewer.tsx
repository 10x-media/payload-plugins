'use client'

import type { DocumentPreviewViewerProps } from '../shared/types'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { InfoCard } from './InfoCard'

/**
 * The browser's own PDF viewer in an iframe: search, print and zoom for zero
 * bundle weight. Browsers without one (Android Chrome reports
 * `navigator.pdfViewerEnabled === false`) get the card with a link instead of
 * an empty frame. The file must be served `inline`, and a cross-origin host
 * must allow framing.
 */
export const PdfViewer = ({ filename, filesize, mimeType, url }: DocumentPreviewViewerProps) => {
	const { t } = useTranslation()
	if (navigator.pdfViewerEnabled === false) {
		return (
			<InfoCard
				filename={filename}
				filesize={filesize}
				message={t(keys.pdfUnsupported)}
				mimeType={mimeType}
			>
				<a
					className="document-preview-card__link"
					href={url}
					rel="noopener noreferrer"
					target="_blank"
				>
					{t(keys.openInNewTab)}
				</a>
			</InfoCard>
		)
	}
	return <iframe className="document-preview-frame" src={url} title={filename} />
}
