'use client'

import { Button } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

import type { ClipRecorderError } from '../recorder/useClipRecorder'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { CameraCheck } from './CameraCheck'
import { copyFileName } from './format'
import { MyRecordings } from './MyRecordings'
import { type SubmissionKind, useRecorder } from './RecorderProvider'

const KINDS: { value: SubmissionKind; label: TranslationKey }[] = [
	{ value: 'bug', label: keys.kindBug },
	{ value: 'question', label: keys.kindQuestion },
	{ value: 'idea', label: keys.kindIdea },
	{ value: 'feedback', label: keys.kindFeedback },
]

const ERROR_TEXT: Record<ClipRecorderError, TranslationKey> = {
	unsupported: keys.errorUnsupported,
	'permission-denied': keys.errorPermission,
	'recording-failed': keys.errorRecording,
	'reserve-failed': keys.errorReserve,
	'upload-failed': keys.errorUpload,
	'complete-failed': keys.errorComplete,
}

/** An object URL for the held take, revoked when the take changes or the drawer goes away. */
const useObjectUrl = (blob: Blob | null): string | null => {
	const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
	useEffect(
		() => () => {
			if (url) URL.revokeObjectURL(url)
		},
		[url]
	)
	return url
}

const KindPicker = () => {
	const { t } = useTranslation()
	const context = useRecorder()
	if (!context) return null
	return (
		<fieldset className="fr-kinds">
			<legend className="fr-label">{t(keys.kindLabel)}</legend>
			{KINDS.map((option) => (
				<label
					className={`fr-kind${context.kind === option.value ? ' fr-kind--active' : ''}`}
					key={option.value}
				>
					<input
						checked={context.kind === option.value}
						name="fr-kind"
						onChange={() => context.setKind(option.value)}
						type="radio"
						value={option.value}
					/>
					{t(option.label)}
				</label>
			))}
		</fieldset>
	)
}

const StartPanel = () => {
	const { t } = useTranslation()
	const context = useRecorder()
	if (!context) return null
	const { recorder } = context
	return (
		<div className="fr-stack">
			<p className="fr-text">{t(keys.intro)}</p>
			<KindPicker />
			<label className="fr-check">
				<input
					checked={context.withCamera}
					onChange={(event) => context.setWithCamera(event.target.checked)}
					type="checkbox"
				/>
				{t(keys.cameraToggle)}
			</label>
			{context.withCamera && recorder.cameraStream ? (
				<CameraCheck
					hint={t(keys.cameraHint)}
					label={t(keys.cameraPreview)}
					stream={recorder.cameraStream}
				/>
			) : null}
			{context.withCamera && recorder.cameraError ? (
				<p className="fr-hint fr-hint--warn">{t(keys.cameraUnavailable)}</p>
			) : null}
			<div className="fr-actions">
				<Button buttonStyle="primary" margin={false} onClick={context.start}>
					{t(keys.start)}
				</Button>
				<label className="fr-file">
					<input
						accept="video/*"
						onChange={(event) => {
							const file = event.target.files?.[0]
							if (file) context.holdFile(file)
							event.target.value = ''
						}}
						type="file"
					/>
					{t(keys.uploadInstead)}
				</label>
			</div>
			<p className="fr-hint">{t(keys.privacyHint)}</p>
		</div>
	)
}

const ReviewPanel = () => {
	const { t } = useTranslation()
	const context = useRecorder()
	const recording = context?.recorder.recording ?? null
	const url = useObjectUrl(recording?.video ?? null)
	const [title, setTitle] = useState('')
	const [note, setNote] = useState('')
	if (!context || !recording) return null
	const { recorder } = context
	const failed = recorder.state === 'failed'

	return (
		<div className="fr-stack">
			<h3 className="fr-heading">{t(keys.reviewHeading)}</h3>
			{url ? (
				<video className="fr-preview" controls preload="metadata" src={url}>
					<track kind="captions" />
				</video>
			) : null}
			<KindPicker />
			<label className="fr-field">
				<span className="fr-label">{t(keys.titleLabel)}</span>
				<input
					className="fr-input"
					maxLength={200}
					onChange={(event) => setTitle(event.target.value)}
					placeholder={t(keys.titlePlaceholder)}
					type="text"
					value={title}
				/>
			</label>
			<label className="fr-field">
				<span className="fr-label">{t(keys.noteLabel)}</span>
				<textarea
					className="fr-input"
					maxLength={5000}
					onChange={(event) => setNote(event.target.value)}
					rows={4}
					value={note}
				/>
			</label>
			{failed && recorder.error ? (
				<p className="fr-error">{t(ERROR_TEXT[recorder.error])}</p>
			) : null}
			<div className="fr-actions">
				<Button buttonStyle="primary" margin={false} onClick={() => context.send({ title, note })}>
					{failed ? t(keys.retry) : t(keys.send)}
				</Button>
				{url ? (
					<a className="fr-link" download={copyFileName(recording.video)} href={url}>
						{t(keys.saveCopy)}
					</a>
				) : null}
				<Button buttonStyle="subtle" margin={false} onClick={recorder.discard}>
					{t(keys.discard)}
				</Button>
			</div>
		</div>
	)
}

const NewRecording = () => {
	const { t } = useTranslation()
	const context = useRecorder()
	if (!context) return null
	const { recorder } = context
	const { state } = recorder

	if (state === 'review' || (state === 'failed' && recorder.recording)) return <ReviewPanel />

	if (state === 'requesting' || state === 'placing') {
		return <p className="fr-text">{t(keys.requesting)}</p>
	}

	if (state === 'counting' || state === 'recording' || state === 'paused') {
		return (
			<p className="fr-text">
				{state === 'counting'
					? t(keys.countdown, { seconds: String(recorder.countdown) })
					: state === 'paused'
						? t(keys.paused)
						: t(keys.recording)}
			</p>
		)
	}

	if (state === 'uploading' || state === 'processing') {
		const percent = recorder.progress
			? Math.round((recorder.progress.sent / Math.max(1, recorder.progress.total)) * 100)
			: 0
		return (
			<div className="fr-stack" role="status">
				<p className="fr-text">
					{state === 'processing'
						? t(keys.processing)
						: t(keys.uploading, { percent: String(percent) })}
				</p>
				<progress
					className="fr-progress"
					max={100}
					value={state === 'processing' ? 100 : percent}
				/>
			</div>
		)
	}

	if (state === 'ready') {
		return (
			<div className="fr-stack" role="status">
				<p className="fr-text fr-text--success">{t(keys.ready)}</p>
				<div className="fr-actions">
					<Button buttonStyle="secondary" margin={false} onClick={recorder.reset}>
						{t(keys.recordAnother)}
					</Button>
				</div>
			</div>
		)
	}

	return (
		<div className="fr-stack">
			{state === 'failed' && recorder.error ? (
				<p className="fr-error">{t(ERROR_TEXT[recorder.error])}</p>
			) : null}
			<StartPanel />
		</div>
	)
}

/** The drawer's two tabs: making a recording, and the ones already sent. */
export const RecorderDrawerBody = () => {
	const { t } = useTranslation()
	const [tab, setTab] = useState<'new' | 'mine'>('new')
	return (
		<div className="fr-body">
			<div className="fr-tabs" role="tablist">
				<button
					aria-selected={tab === 'new'}
					className="fr-tab"
					onClick={() => setTab('new')}
					role="tab"
					type="button"
				>
					{t(keys.tabNew)}
				</button>
				<button
					aria-selected={tab === 'mine'}
					className="fr-tab"
					onClick={() => setTab('mine')}
					role="tab"
					type="button"
				>
					{t(keys.tabMine)}
				</button>
			</div>
			<div role="tabpanel">{tab === 'new' ? <NewRecording /> : <MyRecordings />}</div>
		</div>
	)
}
