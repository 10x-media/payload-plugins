'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import { useWikiMediaDoc } from './useWikiMediaDoc'
import { WikiVideoPlayer } from './WikiVideoPlayer'
import './video.css'

export type GuideVideoProps = {
	relationTo: string
	value: number | string | undefined
}

/**
 * Read renderer for an uploaded-video node: loads the referenced wiki media
 * document and plays it with the default player. A missing or unreadable
 * document degrades to a quiet status line.
 */
export const GuideVideo = ({ relationTo, value }: GuideVideoProps) => {
	const { t } = useTranslation()
	const { videoPlayer } = useWikiTargets()
	const { doc, loading } = useWikiMediaDoc(relationTo, value)

	if (loading) {
		return <p className="wiki-video__status">{t(keys.videoLoading)}</p>
	}
	if (!doc) {
		return <p className="wiki-video__status">{t(keys.videoUnavailable)}</p>
	}
	const Player = videoPlayer ?? WikiVideoPlayer
	return (
		<div className="wiki-video">
			<Player media={doc} />
		</div>
	)
}
