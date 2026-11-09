import { isRecord } from '../core/values'
import type { ReadFailureKind } from '../surfacing/classifyError'
import { PROVIDER_IDS, type ProviderId } from './ids'

/** One provider document's status row, its dates as ISO strings. */
export interface ProviderStatus {
	lastSuccessAt?: string
	lastErrorAt?: string
	errorKind?: ReadFailureKind
	errorDetail?: string
	pausedUntil?: string
}

/** What one read or check told about a document's connection. */
export type ConnectionOutcome =
	| { ok: true }
	| {
			ok: false
			kind: ReadFailureKind
			/** The vendor's own words. */
			detail?: string
			/** How long the source rests from now, when it does. */
			pausedForMs?: number
	  }

/** What the provider status endpoint answers. */
export interface ProviderStatusResponse {
	/** The document's row, empty until a read or a check wrote one. */
	status: ProviderStatus
	/** What the check this POST ran found; absent on a GET and on a debounced POST. */
	checked?: ConnectionOutcome
}

/** What a document's connection last came to, as its form shows it. */
export type ConnectionState = 'works' | 'refused' | 'unreachable' | 'unchecked'

const timeOf = (iso: string | undefined): number | undefined => {
	const at = iso === undefined ? Number.NaN : Date.parse(iso)
	return Number.isNaN(at) ? undefined : at
}

/** The later of the last success and the last failure decides; neither yet is unchecked. */
export const connectionStateOf = (status: ProviderStatus): ConnectionState => {
	const success = timeOf(status.lastSuccessAt)
	const failure = timeOf(status.lastErrorAt)
	if (failure !== undefined && (success === undefined || failure > success)) {
		return status.errorKind === 'unavailable' ? 'unreachable' : 'refused'
	}
	return success === undefined ? 'unchecked' : 'works'
}

const isOptionalString = (value: unknown): boolean =>
	value === undefined || typeof value === 'string'

/** Whether a body is the endpoint's answer; the fields the form reads are checked, the rest kept. */
export const isProviderStatusResponse = (value: unknown): value is ProviderStatusResponse =>
	isRecord(value) &&
	isRecord(value.status) &&
	['lastSuccessAt', 'lastErrorAt', 'errorKind', 'errorDetail', 'pausedUntil'].every((key) =>
		isOptionalString(isRecord(value.status) ? value.status[key] : undefined)
	) &&
	(value.checked === undefined ||
		(isRecord(value.checked) && typeof value.checked.ok === 'boolean'))

/** A stored vendor answer split as a reader reads it: who said it, what, and the HTTP status. */
export interface VendorWords {
	provider?: ProviderId
	message: string
	status?: string
}

/**
 * `posthog: HTTP 403 Bad key`, as `fetchJson` words a refusal, into its parts; any other text is
 * the message as it is.
 */
export const vendorWordsOf = (detail: string): VendorWords => {
	const match = /^([a-z0-9]+): HTTP (\d{3})\s*([\s\S]*)$/.exec(detail)
	const provider = PROVIDER_IDS.find((id) => id === match?.[1])
	if (!match || !provider) {
		return { message: detail.trim() }
	}
	return { provider, message: (match[3] ?? '').trim(), status: match[2] }
}
