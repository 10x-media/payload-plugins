import type { Payload } from 'payload'

/** Root key under `config.custom` where the plugin stashes runtime state for root-level helpers. */
const CUSTOM_KEY = '@10x-media/form-builder'

/**
 * Merge `patch` into the plugin's slice of `config.custom`, leaving every other key untouched.
 * Root-level helpers (`resolvePollOptions`, `resolveConsentStatements`) are called by hosts with a
 * `payload` instance and no plugin state, so the plugin parks what they need on the config at boot
 * and they read it back through `payload.config`. Both readers share one key, so the plugin's slice
 * is patched rather than replaced.
 */
export const stashCustomState = <TState extends Record<string, unknown>>(
	custom: Record<string, unknown> | undefined,
	patch: TState
): Record<string, unknown> => {
	const existing =
		custom?.[CUSTOM_KEY] != null && typeof custom[CUSTOM_KEY] === 'object'
			? (custom[CUSTOM_KEY] as Record<string, unknown>)
			: {}
	return { ...(custom ?? {}), [CUSTOM_KEY]: { ...existing, ...patch } }
}

/** The plugin's slice of `payload.config.custom`, or an empty object when the plugin never booted. */
export const customStateOf = <TState extends Record<string, unknown>>(
	payload: Payload
): Partial<TState> => (payload.config.custom?.[CUSTOM_KEY] as Partial<TState> | undefined) ?? {}
