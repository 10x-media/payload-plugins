'use client'

import {
	Banner,
	FieldLabel,
	fieldBaseClass,
	Pill,
	ShimmerEffect,
	useConfig,
	useFormFields,
} from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { UIFieldClientProps } from 'payload'
import { keys, type TranslationKey } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { viewerNow } from '../ui/viewerClock'
import {
	type ConnectionFailureReason,
	type ConnectionState,
	connectionStateOf,
	vendorWordsOf,
} from './connectionState'
import { PROVIDER_NAMES } from './ids'
import { useProviderStatus, useProviderStatusUrl } from './providerStatusClient'
import '../ui/analytics.css'

const STATE_LABEL: Readonly<Record<ConnectionState, TranslationKey>> = {
	works: keys.providerConnectionConnected,
	refused: keys.providerConnectionNotConnected,
	unreachable: keys.providerConnectionNoAnswer,
	unchecked: keys.providerConnectionUnchecked,
}

/** The status pill's tone: green works, red refused, yellow no answer, gray not checked yet. */
const STATE_PILL: Readonly<
	Record<ConnectionState, 'success' | 'error' | 'warning' | 'light-gray'>
> = {
	works: 'success',
	refused: 'error',
	unreachable: 'warning',
	unchecked: 'light-gray',
}

const HELP: Partial<Record<ConnectionState, TranslationKey>> = {
	refused: keys.providerConnectionRefusedHelp,
	unreachable: keys.providerConnectionUnreachableHelp,
}

const REASON_HELP: Record<ConnectionFailureReason, TranslationKey> = {
	incomplete: keys.providerConnectionIncompleteHelp,
	unknownSite: keys.providerConnectionUnknownSiteHelp,
}

/**
 * The provider form's Connection panel: what the document's connection last came to. Its Test
 * connection button sits beside Save (`ProviderConnectionTest`) and hands the panel its result.
 *
 * @beta
 */
export function ProviderConnection(_props: UIFieldClientProps) {
	const { config } = useConfig()
	const provider = useFormFields(([fields]) => fields.provider?.value)
	const { i18n, t } = useTranslation()
	const url = useProviderStatusUrl()
	const status = useProviderStatus(url)

	// A document not saved yet has nothing checked; its button asks for the save.
	const state: ConnectionState | undefined =
		url === undefined ? 'unchecked' : status ? connectionStateOf(status) : undefined
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
	const reasonHelp =
		state === 'refused' && status?.errorReason ? REASON_HELP[status.errorReason] : undefined
	const help =
		reasonHelp ??
		(state === 'refused' && provider === 'posthog'
			? keys.providerConnectionRefusedHelpPosthog
			: state === 'refused' && provider === 'ga4'
				? keys.providerConnectionRefusedHelpGa4
				: state
					? HELP[state]
					: undefined)

	return (
		<div className={`${fieldBaseClass} analytics-provider-connection`}>
			<FieldLabel as="span" label={t(keys.providerConnectionLabel)} />
			<div className="analytics-provider-connection__body">
				<ul aria-live="polite" className="analytics-provider-connection__facts">
					<li>
						<span className="analytics-provider-connection__fact-label">
							{`${t(keys.providerConnectionStatus)}:\u00a0`}
						</span>
						{state ? (
							<Pill
								className="analytics-provider-connection__status"
								pillStyle={STATE_PILL[state]}
								size="small"
							>
								{t(STATE_LABEL[state])}
							</Pill>
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
			</div>
		</div>
	)
}
