'use client'

import { getTranslation } from '@payloadcms/translations'
import { Gutter, useConfig, useDocumentInfo, useTranslation } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { ClientCollectionConfig } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'
import type React from 'react'
import { useEffect, useState } from 'react'

import { BASE_CLASS } from '../../plugin/constants'
import { Status } from '../internals'

type Props = {
	/** Right-hand controls: the consumer's `BeforeDocumentControls`, the switcher, the save button. */
	children?: React.ReactNode
}

/**
 * The variant's top bar. It reuses the class names of Payload's document controls, so it has
 * the same height, stickiness and responsive behaviour, and a switcher placed at its right end
 * sits exactly where it sits on `native`. The left side carries the same document meta as
 * Payload's bar; saving is not here unless the variant saves on any step.
 */
export const Header: React.FC<Props> = ({ children }) => {
	const { i18n } = useTranslation()
	const { collectionSlug, data, isEditing } = useDocumentInfo()
	const {
		config: {
			admin: { dateFormat },
		},
		getEntityConfig,
	} = useConfig()
	const collectionConfig = getEntityConfig({ collectionSlug }) as ClientCollectionConfig | null
	const [updatedAt, setUpdatedAt] = useState('')
	const [createdAt, setCreatedAt] = useState('')

	// Formatted after mount, as Payload does, so a server and browser time zone mismatch
	// cannot break hydration.
	useEffect(() => {
		setUpdatedAt(
			data?.updatedAt ? formatDate({ date: data.updatedAt, i18n, pattern: dateFormat }) : ''
		)
		setCreatedAt(
			data?.createdAt ? formatDate({ date: data.createdAt, i18n, pattern: dateFormat }) : ''
		)
	}, [data?.createdAt, data?.updatedAt, dateFormat, i18n])

	const drafts = collectionConfig ? hasDraftsEnabled(collectionConfig) : false
	const timestamps = Boolean(collectionConfig?.timestamps) && isEditing

	return (
		<Gutter className={`doc-controls ${BASE_CLASS}__header`}>
			<div className="doc-controls__wrapper">
				<div className="doc-controls__content">
					<ul className="doc-controls__meta">
						{collectionConfig && !isEditing && (
							<li className="doc-controls__list-item">
								<p className="doc-controls__value">
									{i18n.t('general:creatingNewLabel', {
										label: getTranslation(collectionConfig.labels.singular, i18n),
									})}
								</p>
							</li>
						)}
						{drafts && isEditing && (
							<li className="doc-controls__list-item doc-controls__status">
								<Status />
							</li>
						)}
						{timestamps && (
							<>
								<li className="doc-controls__list-item doc-controls__value-wrap" title={updatedAt}>
									<p className="doc-controls__label">{i18n.t('general:lastModified')}:&nbsp;</p>
									<p className="doc-controls__value">{updatedAt}</p>
								</li>
								<li className="doc-controls__list-item doc-controls__value-wrap" title={createdAt}>
									<p className="doc-controls__label">{i18n.t('general:created')}:&nbsp;</p>
									<p className="doc-controls__value">{createdAt}</p>
								</li>
							</>
						)}
					</ul>
				</div>
				<div className="doc-controls__controls-wrapper">
					<div className="doc-controls__controls">{children}</div>
				</div>
			</div>
			<div className="doc-controls__divider" />
		</Gutter>
	)
}
