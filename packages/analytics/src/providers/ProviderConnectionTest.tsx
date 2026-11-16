'use client'

import { Button, toast, useDocumentInfo, useFormFields, useFormModified } from '@payloadcms/ui'
import { useCallback, useState } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { requestShaped } from '../ui/data/request'
import { connectionStateOf, isProviderStatusResponse } from './connectionState'
import { hasConnection, publishProviderStatus, useProviderStatusUrl } from './providerStatusClient'

/**
 * The Test connection button beside a provider document's Save, which checks the saved settings
 * with the vendor's cheapest read and hands the result to the Connection panel. Disabled, it says
 * why in its tooltip; a `native` document has nothing to check and shows none.
 *
 * @beta
 */
export function ProviderConnectionTest() {
	const { hasSavePermission } = useDocumentInfo()
	const modified = useFormModified()
	const provider = useFormFields(([fields]) => fields.provider?.value)
	const { t } = useTranslation()
	const url = useProviderStatusUrl()
	const [checking, setChecking] = useState(false)

	const check = useCallback(async () => {
		if (url === undefined) {
			return
		}
		setChecking(true)
		try {
			const answer = await requestShaped(url, isProviderStatusResponse, { method: 'POST' })
			publishProviderStatus(url, answer.status)
			// A check sent seconds after another is answered from that one, without `checked`.
			const state = connectionStateOf(answer.status)
			const works = answer.checked ? answer.checked.ok : state === 'works'
			if (works) {
				toast.success(t(keys.providerConnectionChecked))
			} else if (answer.checked || state !== 'unchecked') {
				toast.error(t(keys.providerConnectionFailed))
			} else {
				toast.info(t(keys.providerConnectionCheckRunning))
			}
		} catch {
			toast.error(t(keys.providerConnectionFailed))
		} finally {
			setChecking(false)
		}
	}, [t, url])

	if (!hasConnection(provider)) {
		return null
	}
	const blocked =
		url === undefined
			? keys.providerConnectionSaveFirst
			: hasSavePermission === false
				? keys.providerConnectionNoPermission
				: modified
					? keys.providerConnectionUnsaved
					: undefined

	return (
		<Button
			buttonStyle="subtle"
			disabled={blocked !== undefined || checking}
			margin={false}
			onClick={check}
			{...(blocked ? { tooltip: t(blocked) } : {})}
		>
			{t(keys.providerConnectionTest)}
		</Button>
	)
}
