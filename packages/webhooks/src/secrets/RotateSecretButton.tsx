'use client'

import {
	Button,
	ConfirmationModal,
	CopyIcon,
	DialogBody,
	DialogConfirm,
	DialogFooter,
	DialogHeader,
	DialogModal,
	TextInput,
	toast,
	useConfig,
	useDocumentInfo,
	useDrawerSlug,
	useModal,
	useRouter,
} from '@payloadcms/ui'
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

/** Names the input and its label; `TextInput` derives the input's id from it. */
const SECRET_PATH = 'webhooksRotatedSecret'

/**
 * Document control, beside Save, that rotates the subscription's signing secret and reveals the
 * new one once.
 */
export const RotateSecretButton = () => {
	const { id, collectionSlug, docPermissions } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const { openModal } = useModal()
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

	/** `DialogConfirm` closes the dialog itself once this returns. */
	const acknowledge = () => {
		setSecret(null)
		toast.success(t(keys.rotateSecretDone))
	}

	return (
		<>
			<Button
				buttonStyle="secondary"
				margin={false}
				onClick={() => openModal(confirmSlug)}
				size="medium"
				type="button"
			>
				{t(keys.rotateSecret)}
			</Button>
			<ConfirmationModal
				body={t(keys.rotateSecretConfirm)}
				confirmLabel={t(keys.rotateSecret)}
				heading={t(keys.rotateSecretTitle)}
				modalSlug={confirmSlug}
				onConfirm={rotate}
			/>
			{/*
			 * Escape and a click outside would discard the only copy of the new secret without the
			 * acknowledgement, so the dialog closes through its one button only and has no close icon.
			 */}
			<DialogModal
				className="webhooks-reveal"
				closeOnBlur={false}
				closeOnEsc={false}
				role="alertdialog"
				size="medium"
				slug={revealSlug}
			>
				<DialogHeader title={t(keys.rotateSecretRevealTitle)} />
				<DialogBody>
					<p className="webhooks-reveal__body">{t(keys.rotateSecretRevealBody)}</p>
					<TextInput
						AfterInput={
							<button
								aria-label={t(keys.rotateSecretCopy)}
								className="webhooks-reveal__copy"
								onClick={copy}
								title={t(keys.rotateSecretCopy)}
								type="button"
							>
								<CopyIcon size={24} />
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
						htmlAttributes={{ readOnly: true }}
						onChange={() => undefined}
						path={SECRET_PATH}
						value={secret ?? ''}
					/>
				</DialogBody>
				<DialogFooter>
					<DialogConfirm label={t(keys.rotateSecretAcknowledge)} onClick={acknowledge} />
				</DialogFooter>
			</DialogModal>
		</>
	)
}
