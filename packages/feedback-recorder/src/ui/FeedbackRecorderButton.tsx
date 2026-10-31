'use client'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { formatDuration } from './format'
import { useRecorder } from './RecorderProvider'

const LIVE = new Set(['recording', 'paused'])

/**
 * The header button. Renders nothing where the recorder is off for this user or this site (no
 * provider above it). While recording it shows the running time.
 */
export const FeedbackRecorderButton = () => {
	const { t } = useTranslation()
	const context = useRecorder()
	if (!context) return null
	const live = LIVE.has(context.recorder.state)

	return (
		<button
			aria-label={t(keys.openRecorder)}
			className={`fr-header-button${live ? ' fr-header-button--live' : ''}`}
			onClick={context.open}
			title={t(keys.openRecorder)}
			type="button"
		>
			<svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
				<rect height="12" rx="2" stroke="currentColor" strokeWidth="2" width="14" x="2" y="6" />
				<path d="m16 10 6-3v10l-6-3" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
				{live ? <circle cx="9" cy="12" fill="currentColor" r="3" /> : null}
			</svg>
			{live ? (
				<span className="fr-header-button__time">{formatDuration(context.elapsedSeconds)}</span>
			) : null}
		</button>
	)
}
