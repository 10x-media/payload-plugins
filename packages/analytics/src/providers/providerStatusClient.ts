'use client'

import { useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import { isOneOf } from '../core/values'
import { apiPath } from '../plugin/apiPath'
import { analyticsRoutes } from '../plugin/routes'
import { isAbortError, requestShaped } from '../ui/data/request'
import { isProviderStatusResponse, type ProviderStatus } from './connectionState'
import { PROVIDER_IDS } from './ids'

type Listener = (status: ProviderStatus) => void

/**
 * Who shows a document's status, keyed by its status URL: the Test connection button sits in the
 * document controls and the Connection panel in the sidebar, so a check tells the panel this way.
 */
const listeners = new Map<string, Set<Listener>>()

/** Hands a status a check answered to every panel showing that document. */
export const publishProviderStatus = (url: string, status: ProviderStatus): void => {
	for (const listener of listeners.get(url) ?? []) {
		listener(status)
	}
}

/** Whether a provider has a connection to show and test: every vendor, not `native`. */
export const hasConnection = (provider: unknown): boolean =>
	isOneOf(PROVIDER_IDS, provider) && provider !== 'native'

/** The open document's status URL, undefined before its first save. */
export const useProviderStatusUrl = (): string | undefined => {
	const { config } = useConfig()
	const { id } = useDocumentInfo()
	if (id === undefined || id === null) {
		return undefined
	}
	return `${apiPath(config, analyticsRoutes(config).providerStatus)}?id=${encodeURIComponent(String(id))}`
}

/**
 * The open document's last connection result: read on mount and after each save, which may have
 * reset it, and replaced by what a Test connection click answered. Undefined while it loads; a
 * status that cannot be read shows as never checked.
 */
export const useProviderStatus = (url: string | undefined): ProviderStatus | undefined => {
	const { lastUpdateTime } = useDocumentInfo()
	const [status, setStatus] = useState<ProviderStatus>()

	// biome-ignore lint/correctness/useExhaustiveDependencies: `lastUpdateTime` is the save that may have reset the status (a new key, another host), not a value it reads.
	useEffect(() => {
		if (url === undefined) {
			return
		}
		const controller = new AbortController()
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

	useEffect(() => {
		if (url === undefined) {
			return
		}
		const subscribed = listeners.get(url) ?? new Set<Listener>()
		listeners.set(url, subscribed)
		subscribed.add(setStatus)
		return () => {
			subscribed.delete(setStatus)
			if (subscribed.size === 0) {
				listeners.delete(url)
			}
		}
	}, [url])

	return status
}
