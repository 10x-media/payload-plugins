import type { Payload, PayloadRequest } from 'payload'
import { afterTransaction, openTransactionOf } from '../db/openTransaction'
import { nativeInstanceOf } from '../native/engine/instance'
import { getRuntime } from '../plugin/runtime'
import {
	configEpochKeyFor,
	type EpochBackend,
	INITIAL_EPOCH,
	kvEpochBackend,
} from '../surfacing/epoch'

/**
 * Where a `providers.resolve` install keeps each scope's configuration token: `analytics-state`
 * while the native engine runs on the instance, `payload.kv` otherwise.
 */
export const configTokenBackend = (payload: Payload): EpochBackend => {
	const kv = kvEpochBackend(payload, configEpochKeyFor)
	return {
		get: async (scope) => {
			const state = nativeInstanceOf(payload)?.state
			if (!state) {
				return kv.get(scope)
			}
			return (await state.configToken(scope ?? '')) ?? INITIAL_EPOCH
		},
		set: async (scope, token) => {
			const state = nativeInstanceOf(payload)?.state
			if (!state) {
				await kv.set(scope, token)
				return
			}
			await state.setConfigToken(scope ?? '', token)
		},
	}
}

export interface RefreshProvidersOptions {
	/**
	 * The changing save's request, from inside a hook: the token is written once its transaction ends
	 * so nobody reads old settings under it; resolves at once, logging failures.
	 */
	req?: PayloadRequest
}

/**
 * Retires one scope's cached reads on every instance (this one at once, others within ten seconds)
 * for a `providers.resolve` install. Rejects when the token could not be stored.
 */
export const refreshProviders = async (
	payload: Payload,
	scope: string | null = null,
	options: RefreshProvidersOptions = {}
): Promise<void> => {
	const runtime = getRuntime(payload)
	const refresh = runtime?.refreshProviders
	if (!runtime || !refresh) {
		return
	}
	const open = await openTransactionOf(payload, options.req)
	if (!open) {
		await refresh(scope)
		return
	}
	const deferred = afterTransaction(open, () => refresh(scope)).catch((err: unknown) => {
		payload.logger?.warn(
			`analytics: refreshing the providers of scope "${scope ?? ''}" after its save failed: ${String(err)}`
		)
	})
	runtime.engine.keep?.(deferred)
}
