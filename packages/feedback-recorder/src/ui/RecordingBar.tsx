'use client'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { formatDuration } from './format'
import { MicLevelMeter } from './MicLevelMeter'
import { useRecorder } from './RecorderProvider'

/**
 * The small control that stays on screen while recording, in place of the drawer: time, pause,
 * stop and discard. It is in the recording too, the way every screen recorder's control is.
 */
export const RecordingBar = () => {
	const { t } = useTranslation()
	const context = useRecorder()
	if (!context) return null
	const { recorder, elapsedSeconds } = context
	const { state } = recorder

	if (state === 'counting') {
		return (
			<div className="fr-bar" role="status">
				<span className="fr-bar__count">
					{t(keys.countdown, { seconds: String(recorder.countdown) })}
				</span>
				<button className="fr-button" onClick={recorder.discard} type="button">
					{t(keys.discard)}
				</button>
			</div>
		)
	}

	const paused = state === 'paused'
	return (
		<section aria-label={t(keys.recording)} className="fr-bar">
			<span className={`fr-bar__dot${paused ? ' fr-bar__dot--paused' : ''}`} aria-hidden="true" />
			<span className="fr-bar__time">
				{paused ? t(keys.paused) : t(keys.recording)} {formatDuration(elapsedSeconds)}
			</span>
			{recorder.micStream ? (
				<div className="fr-bar__meter">
					<MicLevelMeter
						label={t(keys.micLevel)}
						silentHint={t(keys.micSilent)}
						stream={recorder.micStream}
					/>
				</div>
			) : null}
			<button
				className="fr-button"
				onClick={paused ? recorder.resume : recorder.pause}
				type="button"
			>
				{paused ? t(keys.resume) : t(keys.pause)}
			</button>
			<button className="fr-button fr-button--primary" onClick={recorder.stop} type="button">
				{t(keys.stop)}
			</button>
			<button className="fr-button fr-button--ghost" onClick={recorder.discard} type="button">
				{t(keys.discard)}
			</button>
		</section>
	)
}
