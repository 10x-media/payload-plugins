'use client'

import { useEffect, useState } from 'react'

import { fetchMyRecordings, type MyRecording } from '../client/transport'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { formatDuration } from './format'
import { useRecorder } from './RecorderProvider'

const TRIAGE: Record<NonNullable<MyRecording['triage']>, TranslationKey> = {
	new: keys.triageNew,
	seen: keys.triageSeen,
	inProgress: keys.triageInProgress,
	done: keys.triageDone,
}

const stateLabel = (recording: MyRecording): TranslationKey => {
	if (recording.status === 'failed') return keys.statusFailed
	if (recording.status !== 'ready') return keys.statusProcessing
	return TRIAGE[recording.triage ?? 'new']
}

/** What the signed-in user already sent, and where each one stands with the team. */
export const MyRecordings = () => {
	const { t, i18n } = useTranslation()
	const context = useRecorder()
	const endpoint = context?.config.endpoint
	const [recordings, setRecordings] = useState<MyRecording[] | null>(null)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		if (!endpoint) return
		let cancelled = false
		fetchMyRecordings(endpoint)
			.then((docs) => {
				if (!cancelled) setRecordings(docs)
			})
			.catch(() => {
				if (!cancelled) setFailed(true)
			})
		return () => {
			cancelled = true
		}
	}, [endpoint])

	if (failed) return <p className="fr-error">{t(keys.mineFailed)}</p>
	if (!recordings) return <p className="fr-hint">{t(keys.mineLoading)}</p>
	if (recordings.length === 0) return <p className="fr-hint">{t(keys.mineEmpty)}</p>

	return (
		<ul className="fr-list">
			{recordings.map((recording) => (
				<li className="fr-list__item" key={recording.id}>
					<span className="fr-list__title">{recording.title}</span>
					<span className="fr-list__meta">
						{new Date(recording.createdAt).toLocaleString(i18n.language, {
							dateStyle: 'medium',
							timeStyle: 'short',
						})}
						{recording.durationSeconds ? ` · ${formatDuration(recording.durationSeconds)}` : ''}
					</span>
					<span
						className={`fr-pill fr-pill--${recording.status === 'ready' ? (recording.triage ?? 'new') : recording.status}`}
					>
						{t(stateLabel(recording))}
					</span>
				</li>
			))}
		</ul>
	)
}
