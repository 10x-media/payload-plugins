'use client'

import { getTranslation } from '@payloadcms/translations'
import { formatTimeToNow, Locked, useConfig, useDocumentInfo, useTranslation } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { ClientCollectionConfig, User } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'
import type React from 'react'
import { useEffect, useState } from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { Status } from '../internals'

type Props = {
	/** Payload's `BeforeDocumentMeta` slot, at the start of the bar as on the native form. */
	BeforeDocumentMeta?: React.ReactNode
	/** Right-hand controls: the consumer's `BeforeDocumentControls`, the switcher, the save button. */
	children?: React.ReactNode
	/** Set while the document is open read-only because someone else holds the lock. */
	lockedBy?: User
}

/**
 * The variant's top bar on the full page. It reuses the class names of Payload's document
 * controls, so it has the same height, stickiness and responsive behaviour, and a switcher placed
 * at its right end sits exactly where it sits on `native`. The left side carries the same
 * document meta as Payload's bar; saving is not here unless the variant saves on any step.
 */
export const Header: React.FC<Props> = ({ BeforeDocumentMeta, children, lockedBy }) => {
	const { i18n, t } = useTranslation()
	const { collectionSlug, data, isEditing, isTrashed } = useDocumentInfo()
	const {
		config: {
			admin: { dateFormat },
		},
		getEntityConfig,
	} = useConfig()
	const collectionConfig = getEntityConfig({ collectionSlug }) as ClientCollectionConfig | null
	const [relativeTime, setRelativeTime] = useState('')
	const [formattedDate, setFormattedDate] = useState('')

	const date = (data?.updatedAt ?? data?.createdAt) as string | undefined

	// Formatted after mount, as Payload does, so a server and browser time zone mismatch
	// cannot break hydration.
	useEffect(() => {
		if (!date) {
			setRelativeTime('')
			return
		}
		const update = (): void => setRelativeTime(formatTimeToNow({ date, i18n }))
		update()
		const interval = setInterval(update, 60000)
		return () => clearInterval(interval)
		// `i18n` changes once its date-fns locale has loaded, which is when a time can be formatted.
	}, [date, i18n])

	useEffect(() => {
		setFormattedDate(date ? formatDate({ date, i18n, pattern: dateFormat }) : '')
	}, [date, dateFormat, i18n])

	const drafts = collectionConfig ? hasDraftsEnabled(collectionConfig) : false
	const timestamps = Boolean(collectionConfig?.timestamps) && isEditing && Boolean(date)

	return (
		<div className={`doc-controls ${BASE_CLASS}__header`}>
			<div className="doc-controls__content">
				{(lockedBy || BeforeDocumentMeta) && (
					<div className="doc-controls__before-meta">
						{lockedBy && <Locked className="doc-controls__locked-controls" user={lockedBy} />}
						{BeforeDocumentMeta}
					</div>
				)}
				<ul className="doc-controls__meta">
					{collectionConfig && !isEditing && (
						<li className="doc-controls__list-item">
							<p className="doc-controls__creating-new">
								{i18n.t('general:creatingNewLabel', {
									label: getTranslation(collectionConfig.labels.singular, i18n),
								})}
							</p>
						</li>
					)}
					{drafts && isEditing && (
						<li className="doc-controls__status doc-controls__list-item">
							<Status />
						</li>
					)}
					{timestamps && (
						<li
							className="doc-controls__list-item doc-controls__value-wrap"
							title={formattedDate || undefined}
						>
							<p className="doc-controls__value">
								{relativeTime
									? t(isTrashed ? 'general:deletedAgo' : 'general:updatedAgo', {
											distance: relativeTime,
										})
									: `${t('general:loading')}...`}
							</p>
						</li>
					)}
				</ul>
			</div>
			<div className="doc-controls__controls-wrapper">
				<div className="doc-controls__controls">{children}</div>
			</div>
		</div>
	)
}
