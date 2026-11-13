'use client'

import {
	Banner,
	Button,
	FieldDescription,
	FieldLabel,
	fieldBaseClass,
	ShimmerEffect,
	toast,
	useConfig,
	useDocumentInfo,
	useFormFields,
	useFormModified,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { UIFieldClientProps } from 'payload'
import { useCallback, useEffect, useState } from 'react'
import { apiPath } from '../plugin/apiPath'
import { analyticsRoutes } from '../plugin/routes'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { isAbortError, requestShaped } from '../ui/data/request'
import { viewerNow } from '../ui/viewerClock'
import {
	type ConnectionState,
	connectionStateOf,
	isProviderStatusResponse,
	type ProviderStatus,
	vendorWordsOf,
} from './connectionState'
import { PROVIDER_NAMES } from './ids'
import '../ui/analytics.css'

const STATE_LABEL: Readonly<Record<ConnectionState, TranslationKey>> = {
	works: keys.providerConnectionConnected,
	refused: keys.providerConnectionNotConnected,
	unreachable: keys.providerConnectionNoAnswer,
	unchecked: keys.providerConnectionUnchecked,
}

const HELP: Partial<Record<ConnectionState, TranslationKey>> = {
	refused: keys.providerConnectionRefusedHelp,
	unreachable: keys.providerConnectionUnreachableHelp,
}

/**
 * The provider form's Connection panel: what the document's connection last came to, and the Test
 * connection button, which checks the saved settings with the vendor's cheapest read.
 *
 * @beta
 */
export function ProviderConnection({ path }: UIFieldClientProps) {
	const { config } = useConfig()
	const { hasSavePermission, id, lastUpdateTime } = useDocumentInfo()
	const modified = useFormModified()
	const provider = useFormFields(([fields]) => fields.provider?.value)
	const { i18n, t } = useTranslation()
	const [status, setStatus] = useState<ProviderStatus>()
	const [checking, setChecking] = useState(false)
	const docId = id === undefined || id === null ? undefined : String(id)
	const url =
		docId === undefined
			? undefined
			: `${apiPath(config, analyticsRoutes(config).providerStatus)}?id=${encodeURIComponent(docId)}`

	// biome-ignore lint/correctness/useExhaustiveDependencies: `lastUpdateTime` is the save that may have reset the status (a new key, another host), not a value it reads.
	useEffect(() => {
		if (url === undefined) {
			return
		}
		const controller = new AbortController()
		// A status that cannot be read shows as unchecked: the button still works.
		requestShaped(url, isProviderStatusResponse, { signal: controller.signal }).then(
			(answer) => setStatus(answer.status),
			(err: unknown) => {
				if (!isAbortError(err)) {
					setStatus({})
				}
			}
		)
		return () => controller.abort()
	}, [url, lastUpdateTime])

	const check = useCallback(async () => {
		if (url === undefined) {
			return
		}
		setChecking(true)
		try {
			const answer = await requestShaped(url, isProviderStatusResponse, { method: 'POST' })
			setStatus(answer.status)
			if (answer.checked?.ok === true) {
				toast.success(t(keys.providerConnectionChecked))
			} else if (answer.checked?.ok === false) {
				toast.error(t(keys.providerConnectionFailed))
			}
		} catch {
			toast.error(t(keys.providerConnectionFailed))
		} finally {
			setChecking(false)
		}
	}, [t, url])

	const state = status ? connectionStateOf(status) : undefined
	const when = (iso: string | undefined) =>
		iso ? formatDate({ date: iso, i18n, pattern: config.admin.dateFormat }) : undefined
	const failed = state === 'refused' || state === 'unreachable'
	const pausedUntil =
		status?.pausedUntil && Date.parse(status.pausedUntil) > viewerNow().getTime()
			? when(status.pausedUntil)
			: undefined
	const facts: Array<[TranslationKey, string | undefined]> = [
		[keys.providerConnectionLastSuccess, when(status?.lastSuccessAt)],
		[keys.providerConnectionLastError, failed ? when(status?.lastErrorAt) : undefined],
		[keys.providerConnectionResumes, pausedUntil],
	]
	const shown = facts.filter((fact): fact is [TranslationKey, string] => fact[1] !== undefined)
	const words = failed && status?.errorDetail ? vendorWordsOf(status.errorDetail) : undefined
	const help =
		state === 'refused' && provider === 'posthog'
			? keys.providerConnectionRefusedHelpPosthog
			: state
				? HELP[state]
				: undefined
	const blocked =
		docId === undefined
			? keys.providerConnectionSaveFirst
			: hasSavePermission === false
				? keys.providerConnectionNoPermission
				: modified
					? keys.providerConnectionUnsaved
					: undefined

	return (
		<div className={`${fieldBaseClass} analytics-provider-connection`}>
			<FieldLabel as="span" label={t(keys.providerConnectionLabel)} />
			<div className="analytics-provider-connection__body">
				{docId === undefined ? null : (
					<ul aria-live="polite" className="analytics-provider-connection__facts">
						<li>
							<span className="analytics-provider-connection__fact-label">
								{`${t(keys.providerConnectionStatus)}:\u00a0`}
							</span>
							{state ? (
								<span className="analytics-provider-connection__fact-value">
									{t(STATE_LABEL[state])}
								</span>
							) : (
								<ShimmerEffect height="calc(var(--base) * 0.8)" width="calc(var(--base) * 5)" />
							)}
						</li>
						{shown.map(([label, value]) => (
							<li key={label}>
								<span className="analytics-provider-connection__fact-label">{`${t(label)}:\u00a0`}</span>
								<span className="analytics-provider-connection__fact-value">{value}</span>
							</li>
						))}
					</ul>
				)}
				{failed && help ? (
					<Banner type={state === 'refused' ? 'error' : 'default'}>
						<strong className="analytics-provider-connection__help">{t(help)}</strong>
						{words ? (
							<span className="analytics-provider-connection__words">
								{words.provider ? `${t(PROVIDER_NAMES[words.provider])}: ` : null}
								{words.message}
							</span>
						) : null}
					</Banner>
				) : null}
				<div>
					<Button
						buttonStyle="secondary"
						disabled={blocked !== undefined || checking || state === undefined}
						margin={false}
						onClick={check}
						size="medium"
					>
						{t(keys.providerConnectionTest)}
					</Button>
					{blocked ? (
						<FieldDescription description={t(blocked)} marginPlacement="top" path={path} />
					) : null}
				</div>
			</div>
		</div>
	)
}
