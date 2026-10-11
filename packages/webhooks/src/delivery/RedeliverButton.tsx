'use client'

import {
	Button,
	ConfirmationModal,
	toast,
	useConfig,
	useDocumentInfo,
	useDrawerSlug,
	useModal,
} from '@payloadcms/ui'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

/**
 * Document control, beside Save, that POSTs to the deliveries redeliver endpoint.
 *
 * It confirms first. A redelivery goes out under a fresh `webhook-id`, so a receiver that dedupes
 * on the id processes the payload a second time, which a stray click should not be able to cause.
 */
export const RedeliverButton = () => {
	const { id, collectionSlug } = useDocumentInfo()
	const { config } = useConfig()
	const { t } = useTranslation()
	const { openModal } = useModal()
	const confirmSlug = useDrawerSlug('webhooks-redeliver-confirm')

	if (!id || !collectionSlug) {
		return null
	}

	const apiRoute = config.routes?.api ?? '/api'
	const serverURL = config.serverURL ?? ''

	const redeliver = async () => {
		try {
			const res = await fetch(
				`${serverURL}${apiRoute}/${collectionSlug}/${encodeURIComponent(String(id))}/redeliver`,
				{ method: 'POST', credentials: 'include' }
			)
			if (!res.ok) {
				throw new Error(String(res.status))
			}
			// The endpoint answers 202 whatever happened to the replay, so the outcome is in the
			// body: queued, sent, or refused and rejected, which must not read as a success.
			const { status } = (await res.json()) as { status?: string }
			if (status === 'dead') {
				toast.error(t(keys.redeliverFailed))
				return
			}
			toast.success(t(status === 'success' ? keys.redeliverSent : keys.redeliverDone))
		} catch {
			toast.error(t(keys.redeliverFailed))
		}
	}

	return (
		<>
			<Button
				buttonStyle="subtle"
				margin={false}
				onClick={() => openModal(confirmSlug)}
				size="medium"
				type="button"
			>
				{t(keys.redeliver)}
			</Button>
			<ConfirmationModal
				body={t(keys.redeliverConfirm)}
				confirmLabel={t(keys.redeliver)}
				heading={t(keys.redeliver)}
				modalSlug={confirmSlug}
				onConfirm={redeliver}
			/>
		</>
	)
}
