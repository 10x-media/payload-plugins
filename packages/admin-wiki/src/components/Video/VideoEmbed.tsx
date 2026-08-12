'use client'

import { parseVideoEmbedUrl } from '../../editor/videoEmbed'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import './video.css'

export type VideoEmbedProps = {
	url: string | undefined
}

/**
 * Read renderer for the external video embed block: a privacy-friendly iframe
 * (youtube-nocookie, Vimeo dnt). An unparseable URL degrades to a status line
 * rather than an empty frame.
 */
export const VideoEmbed = ({ url }: VideoEmbedProps) => {
	const { t } = useTranslation()
	const source = url ? parseVideoEmbedUrl(url) : null
	if (!source) {
		return <p className="wiki-video__status">{t(keys.videoUnavailable)}</p>
	}
	return (
		<div className="wiki-video wiki-video--embed">
			<iframe
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
				allowFullScreen
				className="wiki-video__iframe"
				loading="lazy"
				src={source.embedUrl}
				title={t(keys.videoEmbedBlockSingular)}
			/>
		</div>
	)
}
