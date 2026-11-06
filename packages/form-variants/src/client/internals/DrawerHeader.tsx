'use client'

import { getTranslation } from '@payloadcms/translations'
import {
	Button,
	ChevronIcon,
	ConfirmationModal,
	documentDrawerBaseClass,
	formatTimeToNow,
	Locked,
	RenderTitle,
	useConfig,
	useDocumentInfo,
	useFormModified,
	useModal,
	useTranslation,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { ClientCollectionConfig, User } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'

import { Status } from './Status'

/**
 * The header of a document drawer: a bar with the back chevron, "Editing <label>" and the
 * variant's controls, then the document title with its status and last update. It follows
 * Payload's own `DocumentDrawerHeader` on the same class names, so a variant opened in a drawer
 * looks like any other document, with the switcher and save where Payload puts its own.
 *
 * Payload's own `DocumentDrawerHeader` is not exported from `@payloadcms/ui`; see `./index.ts`
 * for why importing it from its subpath is not an option.
 */
const LEAVE_MODAL_SLUG = 'leave-without-saving-doc-drawer'

type Props = {
	/** Rendered at the end of the bar: the switcher and the variant's save controls. */
	actions?: React.ReactNode
	AfterHeader?: React.ReactNode
	BeforeDocumentMeta?: React.ReactNode
	drawerSlug: string
	readOnlyForIncomingUser?: boolean
	renderTitleAsLink?: boolean
	user?: User
}

export const DrawerHeader: React.FC<Props> = ({
	actions,
	AfterHeader,
	BeforeDocumentMeta,
	drawerSlug,
	readOnlyForIncomingUser,
	renderTitleAsLink = true,
	user,
}) => {
	const { closeModal, openModal } = useModal()
	const { i18n, t } = useTranslation()
	const {
		config: {
			admin: { dateFormat },
		},
		getEntityConfig,
	} = useConfig()
	const { id, collectionSlug, data, isEditing, isTrashed } = useDocumentInfo()
	const modified = useFormModified()
	const collectionConfig = getEntityConfig({ collectionSlug }) as ClientCollectionConfig | null
	const [relativeTime, setRelativeTime] = useState('')
	const [formattedDate, setFormattedDate] = useState('')

	const date = (data?.updatedAt ?? data?.createdAt) as string | undefined

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

	const close = useCallback(() => {
		if (modified) {
			openModal(LEAVE_MODAL_SLUG)
		} else {
			closeModal(drawerSlug)
		}
	}, [closeModal, drawerSlug, modified, openModal])

	const singularLabel = getTranslation(
		collectionConfig?.labels?.singular ?? t('general:document'),
		i18n
	)
	const headerLabel = id
		? `${t('general:editing')} ${singularLabel}`
		: t('general:creatingNewLabel', { label: singularLabel })

	const showStatus = Boolean(collectionConfig && hasDraftsEnabled(collectionConfig) && isEditing)
	const showUpdatedAt = Boolean(collectionConfig?.timestamps && isEditing && date)
	const showLocked = Boolean(user && readOnlyForIncomingUser)
	const showBeforeMeta = showLocked || Boolean(BeforeDocumentMeta)
	const showMeta = showBeforeMeta || showStatus || showUpdatedAt

	return (
		<div className={`${documentDrawerBaseClass}__header`}>
			<div className={`${documentDrawerBaseClass}__header-bar`}>
				<div className={`${documentDrawerBaseClass}__header-content`}>
					<Button
						aria-label={t('general:close')}
						buttonStyle="ghost"
						className={`${documentDrawerBaseClass}__header-close`}
						icon={<ChevronIcon direction="left" size={24} />}
						onClick={close}
					/>
					<h2 className={`${documentDrawerBaseClass}__header-text`}>{headerLabel}</h2>
				</div>
				{actions ? (
					<div className={`${documentDrawerBaseClass}__header-actions`}>{actions}</div>
				) : null}
			</div>
			<div className={`${documentDrawerBaseClass}__title-bar`}>
				<RenderTitle
					className={`${documentDrawerBaseClass}__title`}
					element="h3"
					renderAsLink={renderTitleAsLink}
				/>
				{showMeta && (
					<div className={`${documentDrawerBaseClass}__meta`}>
						{showBeforeMeta && (
							<div className={`${documentDrawerBaseClass}__before-meta`}>
								{showLocked && user && (
									<Locked className={`${documentDrawerBaseClass}__locked-controls`} user={user} />
								)}
								{BeforeDocumentMeta}
							</div>
						)}
						{showStatus && <Status />}
						{showUpdatedAt && (
							<span
								className={`${documentDrawerBaseClass}__updated-at`}
								title={formattedDate || undefined}
							>
								{relativeTime
									? t(isTrashed ? 'general:deletedAgo' : 'general:updatedAgo', {
											distance: relativeTime,
										})
									: `${t('general:loading')}...`}
							</span>
						)}
					</div>
				)}
				{AfterHeader ? (
					<div className={`${documentDrawerBaseClass}__after-header`}>{AfterHeader}</div>
				) : null}
			</div>
			<ConfirmationModal
				body={t('general:changesNotSaved')}
				cancelLabel={t('general:stayOnThisPage')}
				confirmLabel={t('general:leaveAnyway')}
				heading={t('general:leaveWithoutSaving')}
				modalSlug={LEAVE_MODAL_SLUG}
				onConfirm={() => closeModal(drawerSlug)}
			/>
		</div>
	)
}
