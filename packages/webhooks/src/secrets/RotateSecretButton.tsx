'use client'

import {
	Button,
	ConfirmationModal,
	CopyIcon,
	Modal,
	TextInput,
	toast,
	useConfig,
	useDocumentInfo,
	useDrawerSlug,
	useModal,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { type RefObject, useRef, useState } from 'react'

import type { TranslationKey } from '../translations/keys'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import './RotateSecretButton.css'

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

/** Names the input and its label; `TextInput` derives the input's id from it. */
const SECRET_PATH = 'webhooksRotatedSecret'

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
	 * staging lives, and can reject even inside one. Payload's own `CopyToClipboard` calls it
	 * unguarded, so this keeps its own handler: the field is selected first, which makes the
	 * fallback one keystroke rather than a hunt, and the last resort says so out loud instead of
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
						<TextInput
							AfterInput={
								<button
									aria-label={t(keys.rotateSecretCopy)}
									className="webhooks-reveal__copy"
									onClick={copy}
									title={t(keys.rotateSecretCopy)}
									type="button"
								>
									<CopyIcon />
								</button>
							}
							className="webhooks-reveal__field"
							// Payload types the prop as a non-null ref, which no `useRef(null)` satisfies
							// under React 19's types; the ref is only read after mount.
							inputRef={secretRef as RefObject<HTMLInputElement>}
							label={t(keys.fieldSecret)}
							// `readOnly` on TextInput renders the input `disabled`, and a disabled input's
							// text cannot be selected, which would take the manual-copy fallback away. The
							// DOM attribute goes on directly instead: not editable, still selectable.
							htmlAttributes={{ readOnly: true } as { autoComplete?: string }}
							onChange={() => undefined}
							path={SECRET_PATH}
							value={secret ?? ''}
						/>
					</div>
					<div className={`${MODAL_CLASS}__controls`}>
						<Button onClick={acknowledge} size="large" type="button">
							{t(keys.rotateSecretAcknowledge)}
						</Button>
					</div>
				</div>
			</Modal>
		</>
	)
}
