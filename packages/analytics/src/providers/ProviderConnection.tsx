'use client'

import {
	Button,
	FieldDescription,
	FieldLabel,
	fieldBaseClass,
	Pill,
	ShimmerEffect,
	toast,
	useConfig,
	useDocumentInfo,
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
} from './connectionState'
import '../ui/analytics.css'

const PILL_STYLE = {
	works: 'success',
	refused: 'error',
	unreachable: 'warning',
	unchecked: 'light-gray',
} as const satisfies Record<ConnectionState, string>

const PILL_LABEL: Readonly<Record<ConnectionState, TranslationKey>> = {
	works: keys.providerConnectionWorks,
	refused: keys.providerConnectionRefused,
	unreachable: keys.providerConnectionUnreachable,
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
	const { id } = useDocumentInfo()
	const modified = useFormModified()
	const { i18n, t } = useTranslation()
	const [status, setStatus] = useState<ProviderStatus>()
	const [checking, setChecking] = useState(false)
	const docId = id === undefined || id === null ? undefined : String(id)
	const url =
		docId === undefined
			? undefined
			: `${apiPath(config, analyticsRoutes(config).providerStatus)}?id=${encodeURIComponent(docId)}`

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
	}, [url])

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
	const lastSuccess = when(status?.lastSuccessAt)
	const failed = state === 'refused' || state === 'unreachable'
	const lastError = failed ? when(status?.lastErrorAt) : undefined
	const pausedUntil =
		status?.pausedUntil && Date.parse(status.pausedUntil) > viewerNow().getTime()
			? when(status.pausedUntil)
			: undefined
	const blocked =
		docId === undefined
			? keys.providerConnectionSaveFirst
			: modified
				? keys.providerConnectionUnsaved
				: undefined
	const note = blocked ?? (state ? HELP[state] : undefined)

	return (
		<div className={`${fieldBaseClass} analytics-provider-connection`}>
			<FieldLabel as="span" label={t(keys.providerConnectionLabel)} />
			<div className="analytics-provider-connection__row" aria-live="polite">
				{docId === undefined ? null : state ? (
					<Pill pillStyle={PILL_STYLE[state]} size="small">
						{t(PILL_LABEL[state])}
					</Pill>
				) : (
					<ShimmerEffect height="calc(var(--base) * 1.2)" width="calc(var(--base) * 4)" />
				)}
				<Button
					buttonStyle="secondary"
					disabled={blocked !== undefined || checking || state === undefined}
					margin={false}
					onClick={check}
					size="small"
				>
					{t(keys.providerConnectionTest)}
				</Button>
			</div>
			{lastSuccess || lastError || pausedUntil ? (
				<ul className="analytics-provider-connection__facts">
					{lastSuccess ? (
						<li>{t(keys.providerConnectionLastSuccess, { date: lastSuccess })}</li>
					) : null}
					{lastError ? <li>{t(keys.providerConnectionLastError, { date: lastError })}</li> : null}
					{pausedUntil ? <li>{t(keys.providerConnectionPaused, { date: pausedUntil })}</li> : null}
				</ul>
			) : null}
			{failed && status?.errorDetail ? (
				<p className="analytics-provider-connection__detail">{status.errorDetail}</p>
			) : null}
			{note ? <FieldDescription description={t(note)} marginPlacement="top" path={path} /> : null}
		</div>
	)
}
