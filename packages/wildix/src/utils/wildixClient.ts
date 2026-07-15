import { WdaHistoryClient } from '@wildix/wda-history-client'
import { WmsApiClient } from '@wildix/wms-api-client'
import { env } from '../env'
import type { WildixCredentials } from '../types'

/**
 * Structural match for `@wildix/smithy-utils`' `TokenProvider`. Declared locally
 * so we don't depend on the transitive package directly.
 */
export type TokenProvider = { token: () => Promise<string> }

/** A token provider that always returns the same static token (API-key mode). */
export const staticTokenProvider = (token: string): TokenProvider => ({
	token: async () => token,
})

const resolvePbxHost = (credentials: WildixCredentials): string => {
	const host = credentials.pbxHost ?? env.WILDIX_PBX_HOST
	if (!host) {
		throw new Error(
			'Wildix credentials: pbxHost is required (or set WILDIX_PBX_HOST). Example: mycompany.wildixin.com'
		)
	}
	return host
}

const resolvePort = (credentials: WildixCredentials): number | undefined => {
	if (credentials.port != null) return credentials.port
	const fromEnv = env.WILDIX_PBX_PORT
	return fromEnv ? Number(fromEnv) : undefined
}

/**
 * Builds a WMS PBX API client. In API-key mode the token is the static
 * `wsk-v1-...` key; in OAuth2 mode pass a refreshing token provider built with
 * `buildRefreshingTokenProvider`.
 */
export const buildWmsClient = (
	credentials: WildixCredentials,
	tokenProvider?: TokenProvider
): WmsApiClient => {
	const provider = tokenProvider ?? resolveApiKeyProvider(credentials)
	return new WmsApiClient({
		domain: resolvePbxHost(credentials),
		port: resolvePort(credentials),
		token: provider,
	})
}

/**
 * Builds a WDA (Wildix Data Analytics) history client. WDA is a cloud service
 * keyed by `env` rather than the PBX host; the token identifies the tenant.
 */
export const buildWdaClient = (
	credentials: WildixCredentials,
	tokenProvider?: TokenProvider
): WdaHistoryClient => {
	const provider = tokenProvider ?? resolveApiKeyProvider(credentials)
	return new WdaHistoryClient({
		env: credentials.wdaEnv ?? 'prod',
		token: provider,
	})
}

const resolveApiKeyProvider = (credentials: WildixCredentials): TokenProvider => {
	if (credentials.authType === 'oauth2') {
		throw new Error(
			'buildWmsClient/buildWdaClient require an explicit token provider in OAuth2 mode. ' +
				'Use buildRefreshingTokenProvider from wildixOAuthClient.ts.'
		)
	}
	const apiKey = credentials.apiKey ?? env.WILDIX_API_KEY
	if (!apiKey) {
		throw new Error(
			'Wildix credentials: apiKey is required for apiKey mode (or set WILDIX_API_KEY). ' +
				'It must be a wsk-v1- prefixed key.'
		)
	}
	return staticTokenProvider(apiKey)
}
