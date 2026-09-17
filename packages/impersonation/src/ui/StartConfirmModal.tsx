'use client'

import { ConfirmationModal, TextInput, toast } from '@payloadcms/ui'
import { type ChangeEvent, useRef, useState } from 'react'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { errorKey, goAfterSwitch, postImpersonation } from './api'

export type StartTarget = {
	collection: string
	id: number | string
	label: string
}

export type StartConfirmModalProps = {
	apiPath: string
	modalSlug: string
	reasonMode: 'off' | 'optional' | 'required'
	target: null | StartTarget
}

/**
 * Payload `ConfirmationModal` for starting a session. Reason uses `TextInput`
 * in the body when the host asked for optional or required notes.
 */
export const StartConfirmModal = ({
	apiPath,
	modalSlug,
	reasonMode,
	target,
}: StartConfirmModalProps) => {
	const { t } = useTranslation()
	const [reason, setReason] = useState('')
	const reasonRef = useRef(reason)
	reasonRef.current = reason
	const targetRef = useRef(target)
	targetRef.current = target

	const onConfirm = async () => {
		const next = targetRef.current
		if (!next) {
			return
		}
		if (reasonMode === 'required' && !reasonRef.current.trim()) {
			toast.error(t(keys.errorReasonRequired))
			throw new Error('reason required')
		}
		const result = await postImpersonation(`${apiPath}/start`, {
			collection: next.collection,
			id: next.id,
			reason: reasonMode === 'off' ? undefined : reasonRef.current,
		})
		if (!result.ok) {
			toast.error(result.error ? t(errorKey(result.error)) : t(keys.errorFailed))
			throw new Error(result.error ?? 'failed')
		}
		goAfterSwitch(result.redirect)
	}

	return (
		<ConfirmationModal
			body={
				<>
					<p>{target?.label}</p>
					{reasonMode === 'off' ? null : (
						<TextInput
							label={t(keys.reasonLabel)}
							onChange={(event: ChangeEvent<HTMLInputElement>) => setReason(event.target.value)}
							path={`${modalSlug}-reason`}
							placeholder={t(keys.reasonPlaceholder)}
							required={reasonMode === 'required'}
							value={reason}
						/>
					)}
				</>
			}
			className="impersonation-confirm-modal"
			confirmLabel={t(keys.confirm)}
			heading={t(keys.confirmTitle)}
			modalSlug={modalSlug}
			onConfirm={onConfirm}
		/>
	)
}
