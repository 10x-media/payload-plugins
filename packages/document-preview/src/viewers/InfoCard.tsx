'use client'

import { formatFilesize } from 'payload/shared'
import { type ReactNode, useMemo } from 'react'

import { useFileIcons } from '../components/Provider/DocumentPreviewProvider'
import { svgDataUri } from '../shared/fileIcons'
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

/**
 * The fallback for every file a viewer cannot show: what the file is, and why
 * there is no preview. Also the error boundary's fallback. Shows the file-type
 * icon inlined as a data URI, so it needs no request and appears whether or not
 * the collection serves icons as thumbnails.
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
	const icons = useFileIcons()
	const icon = useMemo(
		() => svgDataUri(icons.svgFor(icons.keyFor(mimeType, filename)) ?? ''),
		[filename, icons, mimeType]
	)
	const size = filesize === undefined ? undefined : formatFilesize(filesize)
	const reasonMessage =
		reason === 'tooLarge'
			? t(keys.tooLarge, { size })
			: reason === 'failed'
				? t(keys.failed)
				: t(keys.unsupported)
	return (
		<div className="document-preview-card">
			<img alt="" className="document-preview-card__icon" height={96} src={icon} width={96} />
			<p className="document-preview-card__name">{filename}</p>
			<p className="document-preview-card__meta">{[size, mimeType].filter(Boolean).join(' · ')}</p>
			<p className="document-preview-card__message">{message ?? reasonMessage}</p>
			{children}
		</div>
	)
}
