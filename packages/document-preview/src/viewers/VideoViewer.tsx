'use client'

import { useState } from 'react'

import type { DocumentPreviewViewerProps } from '../shared/types'
import { InfoCard } from './InfoCard'

/**
 * Native `<video>` filling the preview, letterboxed on black like a player
 * rather than floating at its intrinsic size. Formats the browser cannot decode
 * fall back to the card.
 */
export const VideoViewer = ({ filename, filesize, mimeType, url }: DocumentPreviewViewerProps) => {
	const [failed, setFailed] = useState(false)
	if (failed) {
		return <InfoCard filename={filename} filesize={filesize} mimeType={mimeType} reason="failed" />
	}
	return (
		<div className="document-preview-video">
			{/* biome-ignore lint/a11y/useMediaCaption: uploads carry no caption track to offer */}
			<video
				className="document-preview-video__player"
				controls
				onError={() => setFailed(true)}
				preload="metadata"
				src={url}
			/>
		</div>
	)
}
