'use client'

import { Button, ConfirmationModal, useDocumentInfo, useFormFields, useModal } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { statusOf } from '../state/resolve'
import { toWindow } from '../state/window'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { useLockApi } from './useLockApi'

const MODAL_SLUG = 'content-lock-end-now'

/** Ends an active lock window after a confirmation. Shown only while the window is active. */
export const EndNowButton = () => {
	const { t } = useTranslation()
	const { collectionSlug, id } = useDocumentInfo()
	const fields = useFormFields(([formFields]) => formFields)
	const { openModal } = useModal()
	const { busy, router, send } = useLockApi(collectionSlug ?? '')
	const [active, setActive] = useState(false)

	const values = {
		id,
		startsAt: fields.startsAt?.value,
		announceAt: fields.announceAt?.value,
		endAtTime: fields.endAtTime?.value,
		endsAt: fields.endsAt?.value,
		endedAt: fields.endedAt?.value,
	}
	const signature = JSON.stringify(values)

	useEffect(() => {
		const parsed = JSON.parse(signature) as Record<string, unknown>
		setActive(
			parsed.id !== undefined &&
				Boolean(parsed.startsAt) &&
				statusOf(toWindow(parsed), new Date()) === 'active'
		)
	}, [signature])

	if (!active || id === undefined) {
		return null
	}

	const endNow = async () => {
		const result = await send(`/${id}`, 'PATCH', { endedAt: new Date().toISOString() })
		if (result) {
			router.refresh()
		}
	}

	return (
		<>
			<Button
				buttonStyle="secondary"
				disabled={busy}
				margin={false}
				onClick={() => openModal(MODAL_SLUG)}
				size="medium"
			>
				{t(keys.actionEndNow)}
			</Button>
			<ConfirmationModal
				body={t(keys.confirmEndNowBody)}
				confirmLabel={t(keys.actionEndNow)}
				heading={t(keys.confirmEndNowHeading)}
				modalSlug={MODAL_SLUG}
				onConfirm={endNow}
			/>
		</>
	)
}
