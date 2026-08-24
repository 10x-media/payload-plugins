'use client'

import {
	Button,
	ConfirmationModal,
	Modal,
	toast,
	useConfig,
	useDocumentInfo,
	useDrawerSlug,
	useModal,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

import type { TranslationKey } from '../translations/keys'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/**
 * Why the rotation was refused, in the caller's terms. A single "could not rotate" hides the
 * difference between a permission problem, a secret the server would not accept, and a concurrent
 * rotation that the operator should simply retry, which are three different next steps.
 */
const FAILURE_BY_STATUS: Record<number, TranslationKey> = {
	400: keys.rotateSecretRejected,
	403: keys.rotateSecretForbidden,
	409: keys.rotateSecretConflict,
}

/**
 * Payload's own confirmation-modal chrome, reused so both dialogs are themed, dark-mode aware,
 * and sized like every other modal in the admin. The stylesheet ships with `ConfirmationModal`,
 * which is imported above.
 */
const MODAL_CLASS = 'confirmation-modal'

/** Doc-view action that rotates the subscription's signing secret and reveals the new one once. */
export const RotateSecretButton = () => {
	const { id, collectionSlug, docPermissions } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const { closeModal, openModal } = useModal()
	const router = useRouter()
	const confirmSlug = useDrawerSlug('webhooks-rotate-confirm')
	const revealSlug = useDrawerSlug('webhooks-rotate-reveal')
	const [secret, setSecret] = useState<string | null>(null)
	const secretRef = useRef<HTMLInputElement>(null)

	// The server returns 403 for a user the collection's update access denies, but the affordance
	// should not be there in the first place.
	if (!id || !collectionSlug || !docPermissions?.update) {
		return null
	}

	const apiRoute = config.routes?.api ?? '/api'
	const serverURL = config.serverURL ?? ''

	const rotate = async () => {
		try {
			const res = await fetch(
				`${serverURL}${apiRoute}/${collectionSlug}/${encodeURIComponent(String(id))}/rotate-secret`,
				{ method: 'POST', credentials: 'include' }
			)
			if (!res.ok) {
				toast.error(t(FAILURE_BY_STATUS[res.status] ?? keys.rotateSecretFailed))
				return
			}
			const result = (await res.json()) as { secret: string }
			setSecret(result.secret)
			openModal(revealSlug)
			// `previousSecretExpiresAt` changed on the server, and this is exactly the moment an
			// operator wants to see when the old secret stops working.
			router.refresh()
		} catch {
			toast.error(t(keys.rotateSecretFailed))
		}
	}

	/**
	 * `navigator.clipboard` is undefined outside a secure context, which is where a good deal of
	 * staging lives, and can reject even inside one. Selecting the field first means the fallback
	 * is one keystroke rather than a hunt, and the last resort says so out loud instead of
	 * silently doing nothing.
	 */
	const copy = async () => {
		secretRef.current?.select()
		try {
			if (secret && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(secret)
				toast.success(t(keys.rotateSecretCopied))
				return
			}
		} catch {
			// fall through to the selection-based copy
		}
		if (secretRef.current && document.execCommand?.('copy')) {
			toast.success(t(keys.rotateSecretCopied))
			return
		}
		toast.error(t(keys.rotateSecretCopyFailed))
	}

	const acknowledge = () => {
		setSecret(null)
		closeModal(revealSlug)
		toast.success(t(keys.rotateSecretDone))
	}

	return (
		<>
			<Button
				buttonStyle="secondary"
				onClick={() => openModal(confirmSlug)}
				size="small"
				type="button"
			>
				{t(keys.rotateSecret)}
			</Button>
			<ConfirmationModal
				body={t(keys.rotateSecretConfirm)}
				cancelLabel={t(keys.rotateSecretCancel)}
				confirmLabel={t(keys.rotateSecret)}
				heading={t(keys.rotateSecretTitle)}
				modalSlug={confirmSlug}
				onConfirm={rotate}
			/>
			<Modal className={MODAL_CLASS} closeOnBlur={false} slug={revealSlug}>
				<div className={`${MODAL_CLASS}__wrapper`}>
					<div className={`${MODAL_CLASS}__content`}>
						<h1>{t(keys.rotateSecretRevealTitle)}</h1>
						<p>{t(keys.rotateSecretRevealBody)}</p>
						<input
							aria-label={t(keys.rotateSecretRevealTitle)}
							onFocus={(e) => e.currentTarget.select()}
							readOnly
							ref={secretRef}
							value={secret ?? ''}
						/>
					</div>
					<div className={`${MODAL_CLASS}__controls`}>
						<Button buttonStyle="secondary" onClick={copy} size="large" type="button">
							{t(keys.rotateSecretCopy)}
						</Button>
						<Button onClick={acknowledge} size="large" type="button">
							{t(keys.rotateSecretAcknowledge)}
						</Button>
					</div>
				</div>
			</Modal>
		</>
	)
}
