import type { Payload, PayloadRequest } from 'payload'
import { monotonicMs } from '../core/monotonic'
import { isRecord } from '../core/values'

/**
 * The request a write outside every transaction passes: `payload.db` finds no `transactionID` on
 * it, so nothing joins a transaction the caller's own request holds, and what is written stays.
 */
export const DETACHED = {}

/** How often work waiting for a transaction asks whether it ended. */
const TRANSACTION_POLL_MS = 50

/** How long work waits for a transaction at most before it runs anyway. */
const TRANSACTION_WAIT_MS = 600_000

const sessionsOf = (payload: Payload): Record<string, unknown> | undefined => {
	const sessions: unknown = Reflect.get(payload.db, 'sessions')
	return isRecord(sessions) ? sessions : undefined
}

/** Whether any transaction begun through the database adapter is open in this process. */
export const anyTransactionOpen = (payload: Payload): boolean => {
	const sessions = sessionsOf(payload)
	return sessions !== undefined && Object.keys(sessions).length > 0
}

/**
 * Whether the transaction `req` runs in is still open, asked of the database adapter's own record
 * of open transactions; undefined when `req` runs in none.
 */
export const openTransactionOf = async (
	payload: Payload,
	req: PayloadRequest | undefined
): Promise<(() => boolean) | undefined> => {
	const id = await req?.transactionID
	if (id === undefined || id === null || id === '') {
		return undefined
	}
	const key = String(id)
	const open = (): boolean => {
		const sessions = sessionsOf(payload)
		return sessions !== undefined && Object.hasOwn(sessions, key)
	}
	return open() ? open : undefined
}

/**
 * Runs `work` once `open` answers false, committed or rolled back alike, or once
 * {@link TRANSACTION_WAIT_MS} has passed, asking every {@link TRANSACTION_POLL_MS}.
 */
export const afterTransaction = async <T>(
	open: () => boolean,
	work: () => Promise<T>,
	timing: { pollMs?: number; waitMs?: number } = {}
): Promise<T> => {
	const pollMs = timing.pollMs ?? TRANSACTION_POLL_MS
	const until = monotonicMs() + (timing.waitMs ?? TRANSACTION_WAIT_MS)
	while (open() && monotonicMs() < until) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, pollMs).unref?.()
		})
	}
	return work()
}
