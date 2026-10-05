'use client'

import { formatFilesize } from 'payload/shared'
import type { ReactNode } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

export type InfoCardReason = 'failed' | 'tooLarge' | 'unsupported'

export type InfoCardProps = {
	/** Extra content under the message, such as a link. */
	children?: ReactNode
	filename: string
	filesize?: number
	/** Overrides the reason's built-in message. */
	message?: string
	mimeType: string
	reason?: InfoCardReason
}

const FileIcon = () => (
	<svg aria-hidden="true" fill="none" height="40" viewBox="0 0 24 24" width="40">
		<path
			d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"
			stroke="currentColor"
			strokeLinejoin="round"
			strokeWidth="1.5"
		/>
		<path d="M14 3v5h5" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
	</svg>
)

/**
 * The fallback for every file a viewer cannot show: what the file is, and why
 * there is no preview. Also the error boundary's fallback.
 */
export const InfoCard = ({
	children,
	filename,
	filesize,
	message,
	mimeType,
	reason = 'unsupported',
}: InfoCardProps) => {
	const { t } = useTranslation()
	const size = filesize === undefined ? undefined : formatFilesize(filesize)
	const reasonMessage =
		reason === 'tooLarge'
			? t(keys.tooLarge, { size })
			: reason === 'failed'
				? t(keys.failed)
				: t(keys.unsupported)
	return (
		<div className="document-preview-card">
			<span className="document-preview-card__icon">
				<FileIcon />
			</span>
			<p className="document-preview-card__name">{filename}</p>
			<p className="document-preview-card__meta">{[size, mimeType].filter(Boolean).join(' · ')}</p>
			<p className="document-preview-card__message">{message ?? reasonMessage}</p>
			{children}
		</div>
	)
}
