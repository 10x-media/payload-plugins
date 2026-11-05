import type { SerializedCapabilities } from '../../core/capabilities'
import { isRecord } from '../../core/values'
import type { SourcesNotice } from '../../plugin/readContextForRequest'
import { requestShaped } from '../../ui/data/request'
import { createSharedCache } from '../../ui/data/sharedCache'

export interface WireSource {
	id: string
	label: string
	kind: 'config' | 'runtime'
	capabilities: SerializedCapabilities
}

export type { SourcesNotice }

export interface SourcesResponse {
	defaultId: string | null
	sources: WireSource[]
	/** What the reader should be told about the listing itself; absent, nothing. */
	notice?: SourcesNotice
}

const isStringList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'string')

/** The parts of a source the pickers read: who it is and the lists its capabilities gate on. */
const isWireSource = (value: unknown): value is WireSource =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.label === 'string' &&
	(value.kind === 'config' || value.kind === 'runtime') &&
	isRecord(value.capabilities) &&
	isStringList(value.capabilities.metrics) &&
	isStringList(value.capabilities.dimensions) &&
	isRecord(value.capabilities.filters)

const isSourcesResponse = (value: unknown): value is SourcesResponse =>
	isRecord(value) &&
	(value.defaultId === null || typeof value.defaultId === 'string') &&
	(value.notice === undefined || value.notice === 'platformFallback') &&
	Array.isArray(value.sources) &&
	value.sources.every(isWireSource)

/** The listing read fresh, past the shared cache, for a surface that must not show a stale one. */
export const requestSources = (url: string, signal?: AbortSignal): Promise<SourcesResponse> =>
	requestShaped(url, isSourcesResponse, { signal })

const cache = createSharedCache<SourcesResponse>()

/**
 * Source list shared by every picker on the page, keyed by scope so a login or tenant switch reads
 * again. A refusal or misshapen answer rejects and drops the entry, so a later mount retries.
 */
export const fetchSources = (url: string, scope: string): Promise<SourcesResponse> =>
	cache.read({ route: url, scope }, () => requestSources(url))
