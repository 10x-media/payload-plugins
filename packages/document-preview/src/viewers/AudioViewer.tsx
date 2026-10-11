'use client'

import { useState } from 'react'

import type { DocumentPreviewViewerProps } from '../shared/types'
import { InfoCard } from './InfoCard'

/**
 * Native `<audio>` centered in the preview, so playback streams with range
 * requests and needs no CORS. The file's name is already in the drawer title or
 * the upload area above an inline preview. Formats the browser cannot decode
 * fall back to the info card.
 */
export const AudioViewer = ({ filename, filesize, mimeType, url }: DocumentPreviewViewerProps) => {
	const [failed, setFailed] = useState(false)
	if (failed) {
		return <InfoCard filename={filename} filesize={filesize} mimeType={mimeType} reason="failed" />
	}
	return (
		<div className="document-preview-audio">
			{/* biome-ignore lint/a11y/useMediaCaption: uploads carry no caption track to offer */}
			<audio
				className="document-preview-audio__control"
				controls
				onError={() => setFailed(true)}
				preload="metadata"
				src={url}
			/>
		</div>
	)
}
