'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { WikiMediaDoc } from './useWikiMediaDoc'
import './video.css'

export type WikiVideoPlayerProps = {
	media: WikiMediaDoc
}

/** The default player: a plain HTML5 `<video>` for the media document. */
export const WikiVideoPlayer = ({ media }: WikiVideoPlayerProps) => {
	const { t } = useTranslation()
	if (!media.url) {
		return <p className="wiki-video__status">{t(keys.videoUnavailable)}</p>
	}
	return (
		<video className="wiki-video__player" controls preload="metadata" src={media.url}>
			<track kind="captions" />
		</video>
	)
}
