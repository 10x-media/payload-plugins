'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { ChatSlotProps } from '../client/components'
import { CrossIcon } from '../composer/icons'
import { useComposerFiles } from '../react/composerAddons'
import { useExtension } from '../react/hooks'
import { ChatScope } from '../react/provider'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { ConversationMessage } from '../types'
import { useAttachments, useAttachmentsComposer } from './react'
import {
	ATTACHMENTS,
	type AttachmentsClientData,
	type AttachmentView,
	formatSize,
	isImage,
} from './shared'
import './attachments.css'

const PaperclipIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<path
			d="m13.25 7.4-5.3 5.3a3.25 3.25 0 0 1-4.6-4.6l5.66-5.66a2.17 2.17 0 0 1 3.07 3.07l-5.66 5.66a1.08 1.08 0 0 1-1.53-1.53l5.3-5.3"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.3"
		/>
	</svg>
)

const FileIcon = () => (
	<svg aria-hidden="true" fill="none" height="18" viewBox="0 0 16 16" width="18">
		<path
			d="M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10c0 .69.56 1.25 1.25 1.25h7c.69 0 1.25-.56 1.25-1.25V5.5M9 1.75l3.75 3.75M9 1.75V5.5h3.75"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.2"
		/>
	</svg>
)

const DownloadIcon = () => (
	<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 16 16" width="16">
		<path
			d="M8 2.5v8m0 0L4.75 7.25M8 10.5l3.25-3.25M3 13.25h10"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.3"
		/>
	</svg>
)

/** Shown in the viewer rather than a new tab: images and PDFs. */
const viewable = (file: AttachmentView) => isImage(file) || file.mimeType === 'application/pdf'

const PickButton = () => {
	const { t } = useTranslation()
	const intake = useComposerFiles()
	const settings = useExtension<AttachmentsClientData>(ATTACHMENTS)
	const input = useRef<HTMLInputElement>(null)
	if (!intake?.acceptsFiles || !settings) return null
	return (
		<>
			<button
				aria-label={t(keys.attachFiles)}
				className="conversations-attach-button"
				onClick={() => input.current?.click()}
				title={t(keys.attachFiles)}
				type="button"
			>
				<PaperclipIcon />
			</button>
			<input
				accept={settings.mimeTypes.length > 0 ? settings.mimeTypes.join(',') : undefined}
				hidden
				multiple
				onChange={(event) => {
					intake.addFiles([...(event.target.files ?? [])])
					event.target.value = ''
				}}
				ref={input}
				type="file"
			/>
		</>
	)
}

/** `composerActions` slot: the paperclip next to Send. */
export const AttachButton = ({ instance }: ChatSlotProps) => (
	<ChatScope instance={instance}>
		<PickButton />
	</ChatScope>
)

const Picked = ({ channel, conversationKey }: { channel: string; conversationKey: string }) => {
	const { t } = useTranslation()
	const { files, maxFiles, rejected, remove } = useAttachmentsComposer({ channel, conversationKey })
	if (files.length === 0 && rejected.length === 0) return null
	return (
		<div className="conversations-attach-picked">
			{files.length > 0 ? (
				<ul className="conversations-attach-picked__list">
					{files.map((entry) => (
						<li className="conversations-attach-chip" key={entry.id}>
							{entry.preview ? (
								<img alt="" className="conversations-attach-chip__thumb" src={entry.preview} />
							) : (
								<span className="conversations-attach-chip__icon">
									<FileIcon />
								</span>
							)}
							<span className="conversations-attach-chip__name">{entry.file.name}</span>
							<span className="conversations-attach-chip__size">{formatSize(entry.file.size)}</span>
							<button
								aria-label={t(keys.attachmentRemove, { name: entry.file.name })}
								className="conversations-attach-chip__remove"
								onClick={() => remove(entry.id)}
								type="button"
							>
								<CrossIcon />
							</button>
						</li>
					))}
				</ul>
			) : null}
			{rejected.map((entry) => (
				<p className="conversations-attach-picked__error" key={`${entry.reason}:${entry.filename}`}>
					{entry.reason === 'type'
						? t(keys.attachmentType, { name: entry.filename })
						: t(keys.attachmentTooMany, { count: maxFiles })}
				</p>
			))}
		</div>
	)
}

/**
 * `composerBelow` slot: the files picked for the next message, inside the
 * composer's box. It also takes the composer's drops and pastes.
 */
export const AttachmentsPicker = ({ channel, conversationKey, instance }: ChatSlotProps) =>
	channel ? (
		<ChatScope instance={instance}>
			<Picked channel={channel} conversationKey={conversationKey} />
		</ChatScope>
	) : null

/** Images and PDFs of one message, full size, one at a time. */
const Viewer = ({
	files,
	onClose,
	start,
}: {
	files: AttachmentView[]
	onClose: () => void
	start: number
}) => {
	const { t } = useTranslation()
	const [index, setIndex] = useState(start)
	const file = files[index]
	const step = useCallback(
		(by: number) => setIndex((current) => (current + by + files.length) % files.length),
		[files.length]
	)
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
			if (event.key === 'ArrowRight') step(1)
			if (event.key === 'ArrowLeft') step(-1)
		}
		document.addEventListener('keydown', onKey)
		return () => document.removeEventListener('keydown', onKey)
	}, [onClose, step])
	if (!file?.url) return null
	return createPortal(
		<div
			aria-label={file.filename}
			aria-modal="true"
			className="conversations-attach-viewer"
			role="dialog"
		>
			<button
				aria-label={t(keys.close)}
				className="conversations-attach-viewer__backdrop"
				onClick={onClose}
				tabIndex={-1}
				type="button"
			/>
			<div className="conversations-attach-viewer__bar">
				<span className="conversations-attach-viewer__name">{file.filename}</span>
				{files.length > 1 ? (
					<span className="conversations-attach-viewer__count">
						{index + 1} / {files.length}
					</span>
				) : null}
				<a
					aria-label={t(keys.attachmentDownload, { name: file.filename })}
					className="conversations-attach-viewer__action"
					download={file.filename}
					href={file.url}
				>
					<DownloadIcon />
				</a>
				<button
					aria-label={t(keys.close)}
					className="conversations-attach-viewer__action"
					onClick={onClose}
					type="button"
				>
					<CrossIcon />
				</button>
			</div>
			{isImage(file) ? (
				<img alt={file.filename} className="conversations-attach-viewer__image" src={file.url} />
			) : (
				<iframe
					className="conversations-attach-viewer__frame"
					src={file.url}
					title={file.filename}
				/>
			)}
			{files.length > 1 ? (
				<>
					<button
						aria-label={t(keys.attachmentPrevious)}
						className="conversations-attach-viewer__step conversations-attach-viewer__step--prev"
						onClick={() => step(-1)}
						type="button"
					>
						‹
					</button>
					<button
						aria-label={t(keys.attachmentNext)}
						className="conversations-attach-viewer__step conversations-attach-viewer__step--next"
						onClick={() => step(1)}
						type="button"
					>
						›
					</button>
				</>
			) : null}
		</div>,
		document.body
	)
}

const Files = ({ message }: { message: ConversationMessage }) => {
	const { t } = useTranslation()
	const { files, uploads } = useAttachments(message)
	const [open, setOpen] = useState<null | number>(null)
	if (files.length === 0 && uploads.length === 0) return null
	const inViewer = files.filter(viewable)
	const images = files.filter(isImage)
	const others = files.filter((file) => !isImage(file))
	const show = (file: AttachmentView) => setOpen(inViewer.indexOf(file))
	return (
		<div className="conversations-attachments">
			{images.length > 0 ? (
				<div className="conversations-attachments__images">
					{images.map((file) => (
						<button
							aria-label={t(keys.attachmentOpen, { name: file.filename })}
							className="conversations-attachments__image"
							key={String(file.id)}
							onClick={() => show(file)}
							type="button"
						>
							<img alt={file.filename} loading="lazy" src={file.thumbnail ?? file.url ?? ''} />
						</button>
					))}
				</div>
			) : null}
			{others.map((file) => (
				<div className="conversations-attachments__file" key={String(file.id)}>
					<span className="conversations-attachments__icon">
						<FileIcon />
					</span>
					{viewable(file) ? (
						<button
							className="conversations-attachments__name"
							onClick={() => show(file)}
							type="button"
						>
							{file.filename}
						</button>
					) : (
						<a
							className="conversations-attachments__name"
							href={file.url ?? undefined}
							rel="noreferrer"
							target="_blank"
						>
							{file.filename}
						</a>
					)}
					<span className="conversations-attachments__size">{formatSize(file.filesize)}</span>
					{file.url ? (
						<a
							aria-label={t(keys.attachmentDownload, { name: file.filename })}
							className="conversations-attachments__download"
							download={file.filename}
							href={file.url}
						>
							<DownloadIcon />
						</a>
					) : null}
				</div>
			))}
			{uploads.map((upload, index) => (
				<p
					className={`conversations-attachments__upload conversations-attachments__upload--${upload.status}`}
					// biome-ignore lint/suspicious/noArrayIndexKey: two uploads may share a name; the list never reorders.
					key={index}
					title={upload.error ?? undefined}
				>
					{upload.status === 'failed'
						? t(keys.attachmentFailed, { name: upload.filename })
						: t(keys.attachmentUploading, { name: upload.filename })}
				</p>
			))}
			{open !== null && open >= 0 ? (
				<Viewer files={inViewer} onClose={() => setOpen(null)} start={open} />
			) : null}
		</div>
	)
}

/** `messageFooter` slot: a message's files; images and PDFs open in a viewer. */
export const AttachmentsList = ({ instance, message }: ChatSlotProps) =>
	message && !message.deletedAt ? (
		<ChatScope instance={instance}>
			<Files message={message} />
		</ChatScope>
	) : null
