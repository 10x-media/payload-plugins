import type { Payload } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import { classifyError } from '../surfacing/classifyError'
import type { ConnectionOutcome } from './connectionState'

/** How long a connection check waits for the vendor before it counts as unreachable. */
const CONNECTION_CHECK_TIMEOUT_MS = 10_000

/**
 * What a check's failure says about the connection: a vendor refusing the cheapest read it has is
 * set up wrong whatever its status code, so only an outage stays `unavailable`.
 */
const checkFailureOf = (err: unknown): ConnectionOutcome => {
	const failure = classifyError(err)
	return {
		ok: false,
		kind: failure.kind === 'unavailable' ? 'unavailable' : 'source_misconfigured',
		...(!failure.hostRefused && err instanceof Error ? { detail: err.message } : {}),
	}
}

/** What a provider document's check found; an incomplete document is refused without asking the vendor. */
export const checkConnectionOf = async (
	payload: Payload,
	adapter: AnalyticsAdapter
): Promise<ConnectionOutcome> => {
	if (!adapter.isConfigured()) {
		return { ok: false, kind: 'source_misconfigured' }
	}
	try {
		await adapter.checkConnection?.({
			signal: AbortSignal.timeout(CONNECTION_CHECK_TIMEOUT_MS),
			timeoutMs: CONNECTION_CHECK_TIMEOUT_MS,
			payload,
		})
		return { ok: true }
	} catch (err) {
		return checkFailureOf(err)
	}
}
