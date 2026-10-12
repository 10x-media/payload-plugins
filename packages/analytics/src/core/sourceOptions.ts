import {
	connectionFieldAccess,
	PROVIDERS_SLUG,
	type ProviderCollectionFieldOverrides,
} from '../providers/collection'
import { resolveHostPolicy } from '../providers/hosts'
import { resolveScopedCollection } from './collectionOption'
import { keysOf, optionalFunction, optionalList, optionsObject } from './optionChecks'
import type { ProvidersCollectionOptions, ProvidersOptions, ResolvedOptions } from './options'
import { isRecord, kindOf, listOf } from './values'

const PROVIDERS_KEYS = keysOf<ProvidersOptions>({ collection: true, resolve: true, hosts: true })
const PROVIDERS_COLLECTION_KEYS = keysOf<ProvidersCollectionOptions>({
	slug: true,
	scopeField: true,
	fields: true,
	overrides: true,
	access: true,
	encryption: true,
	connectionAccess: true,
	sourceAccess: true,
})
const PROVIDER_FIELD_KEYS = keysOf<ProviderCollectionFieldOverrides>({
	name: true,
	provider: true,
	enabled: true,
})
const ENCRYPTION_KEYS = keysOf<NonNullable<ProvidersCollectionOptions['encryption']>>({
	keys: true,
})

const isAdapterShaped = (value: unknown): value is { id: string } =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	value.id !== '' &&
	typeof value.isConfigured === 'function' &&
	typeof value.query === 'function' &&
	isRecord(value.capabilities)

/** `adapters`: a list of adapters with an id each, no two sharing one. */
export const assertAdapters = (value: unknown): void => {
	const ids = new Set<string>()
	for (const [index, adapter] of optionalList(value, 'adapters', '[native()]').entries()) {
		if (!isAdapterShaped(adapter)) {
			throw new Error(
				`analytics: adapters[${index}] must be an adapter such as native() or plausible({ siteId, apiKey }), got ${kindOf(adapter)}`
			)
		}
		if (ids.has(adapter.id)) {
			throw new Error(
				`analytics: adapters lists two adapters with the id "${adapter.id}"; every source is read by its id, so give each its own`
			)
		}
		ids.add(adapter.id)
	}
}

/** An option naming one of `adapters` by its id. */
export const assertNamesAdapter = (
	value: unknown,
	path: string,
	adapters: readonly { id: string }[]
): void => {
	if (value === undefined) {
		return
	}
	if (typeof value !== 'string') {
		throw new Error(
			`analytics: ${path} must be the id of an adapter in adapters, got ${kindOf(value)}`
		)
	}
	if (!adapters.some((adapter) => adapter.id === value)) {
		throw new Error(
			`analytics: ${path} "${value}" names no adapter in adapters, whose ids are ${listOf(adapters.map((adapter) => `"${adapter.id}"`))}`
		)
	}
}

/** `providers.collection.encryption`: a dedicated key ring, or nothing. */
const assertEncryption = (value: unknown): void => {
	if (value === undefined) {
		return
	}
	const { keys } = optionsObject(value, {
		path: 'providers.collection.encryption',
		known: ENCRYPTION_KEYS,
		example: 'an object such as { keys }',
	})
	if (
		keys !== undefined &&
		(!isRecord(keys) || typeof keys.active !== 'string' || !isRecord(keys.keys))
	) {
		throw new Error(
			`analytics: providers.collection.encryption.keys must be a key set such as { active: 'k1', keys: { k1: process.env.PROVIDER_KEY } }, got ${kindOf(keys)}`
		)
	}
}

/** `providers.collection` turned on, with what only that collection takes. */
const resolveProvidersCollection = (
	option: ProvidersOptions['collection']
): ResolvedOptions['providers']['collection'] => {
	const collection = resolveScopedCollection(option, {
		path: 'providers.collection',
		fallback: PROVIDERS_SLUG,
		known: PROVIDERS_COLLECTION_KEYS,
		fieldKeys: PROVIDER_FIELD_KEYS,
		exampleSlug: 'providers',
	})
	if (option === undefined || typeof option === 'boolean') {
		return collection
	}
	assertEncryption(option.encryption)
	const connectionAccess = connectionFieldAccess(
		'providers.collection.connectionAccess',
		option.connectionAccess
	)
	const sourceAccess = optionalFunction(option.sourceAccess, 'providers.collection.sourceAccess')
	return {
		...collection,
		...(option.encryption ? { encryption: option.encryption } : {}),
		...(connectionAccess ? { connectionAccess } : {}),
		...(sourceAccess ? { sourceAccess } : {}),
	}
}

/** `providers`: the collection or `resolve` (never both), and the hosts either may reach. */
export const resolveProviders = (
	option: ProvidersOptions | undefined
): ResolvedOptions['providers'] => {
	if (option !== undefined) {
		optionsObject(option, {
			path: 'providers',
			known: PROVIDERS_KEYS,
			example: 'an object such as { collection: true }',
		})
	}
	const resolve = optionalFunction(option?.resolve, 'providers.resolve')
	const collection = resolveProvidersCollection(option?.collection)
	if (resolve && collection.enabled) {
		throw new Error(
			"analytics: providers.resolve and providers.collection cannot both be set. resolve replaces the collection lookup, so the adapters it returns would be filtered by provider document ids no reader holds, and the collection's sourceAccess and connectionAccess would do nothing. Keep one of them."
		)
	}
	if (option?.hosts !== undefined && !collection.enabled && !resolve) {
		throw new Error(
			'analytics: providers.hosts only applies to provider documents, so it needs providers.collection or providers.resolve. Set one of them, or remove it.'
		)
	}
	return {
		collection,
		...(resolve ? { resolve } : {}),
		hosts: resolveHostPolicy(option?.hosts),
	}
}
