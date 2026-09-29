import type { Payload } from 'payload'
import { customStateOf, stashCustomState } from './customState'

/** The slugs of the collections the plugin registers, after host overrides. */
export type FormBuilderCollectionSlugs = {
	forms: string
	formSubmissions: string
	pollVotes: string
}

export const DEFAULT_COLLECTION_SLUGS = Object.freeze({
	forms: 'forms',
	formSubmissions: 'form-submissions',
	pollVotes: 'form-poll-votes',
} as const)

export const DEFAULT_VOTED_COOKIE_PREFIX = 'fb-voted-'

type SlugOverride = { slug?: string } | undefined

/** The slice of the plugin options slugs are read from; structural so this module stays a leaf. */
export type CollectionSlugOptions = {
	overrides?: { forms?: SlugOverride; formSubmissions?: SlugOverride }
	poll?: { votes?: false | { overrides?: SlugOverride } }
}

const OPTION_PATHS: Record<keyof FormBuilderCollectionSlugs, string> = {
	forms: 'overrides.forms.slug',
	formSubmissions: 'overrides.formSubmissions.slug',
	pollVotes: 'poll.votes.overrides.slug',
}

const slugOf = (override: SlugOverride, fallback: string): string => {
	const slug = override?.slug?.trim()
	return slug ? slug : fallback
}

/**
 * Resolve every plugin collection slug from the `slug` each collection's override carries,
 * falling back to the defaults. Throws when two plugin collections would share a slug, since
 * Payload would merge them into one collection with the other's fields and hooks.
 */
export const resolveCollectionSlugs = (
	options: CollectionSlugOptions
): FormBuilderCollectionSlugs => {
	const votes = options.poll?.votes
	const slugs: FormBuilderCollectionSlugs = {
		forms: slugOf(options.overrides?.forms, DEFAULT_COLLECTION_SLUGS.forms),
		formSubmissions: slugOf(
			options.overrides?.formSubmissions,
			DEFAULT_COLLECTION_SLUGS.formSubmissions
		),
		pollVotes: slugOf(
			votes === false ? undefined : votes?.overrides,
			DEFAULT_COLLECTION_SLUGS.pollVotes
		),
	}
	const registered = (Object.keys(slugs) as (keyof FormBuilderCollectionSlugs)[]).filter(
		(key) => key !== 'pollVotes' || votes !== false
	)
	for (const [index, key] of registered.entries()) {
		const clash = registered.slice(index + 1).find((other) => slugs[other] === slugs[key])
		if (clash) {
			throw new Error(
				`@10x-media/form-builder: ${OPTION_PATHS[key]} and ${OPTION_PATHS[clash]} both resolve to "${slugs[key]}"; each plugin collection needs its own slug.`
			)
		}
	}
	return slugs
}

const COOKIE_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Validate `poll.cookiePrefix` at boot, so a bad name fails loudly instead of breaking `Set-Cookie`. */
export const resolveVotedCookiePrefix = (prefix: string | undefined): string => {
	if (prefix === undefined) {
		return DEFAULT_VOTED_COOKIE_PREFIX
	}
	if (!COOKIE_NAME_TOKEN.test(prefix)) {
		throw new Error(
			`@10x-media/form-builder: poll.cookiePrefix "${prefix}" is not a valid cookie name; use letters, digits, and !#$%&'*+-.^_\`|~ only.`
		)
	}
	return prefix
}

type SlugState = { collectionSlugs: FormBuilderCollectionSlugs; votedCookiePrefix?: string }

export const stashCollectionSlugs = (
	custom: Record<string, unknown> | undefined,
	collectionSlugs: FormBuilderCollectionSlugs,
	votedCookiePrefix?: string
): Record<string, unknown> =>
	stashCustomState<SlugState>(custom, {
		collectionSlugs,
		...(votedCookiePrefix === undefined ? {} : { votedCookiePrefix }),
	})

/**
 * The collection slugs the plugin registered on this Payload instance, for code that queries the
 * plugin's collections (`payload.find({ collection: collectionSlugsOf(payload).formSubmissions })`).
 * The defaults when the plugin is disabled or absent.
 */
export const collectionSlugsOf = (payload: Payload): FormBuilderCollectionSlugs =>
	customStateOf<SlugState>(payload).collectionSlugs ?? { ...DEFAULT_COLLECTION_SLUGS }

/**
 * The resolved slugs typed as the default literals, for the plugin's own Local API calls. A plugin
 * collection keeps the plugin's document shape under any slug, which is exactly what generated types
 * for the default slugs describe, so reads narrow as they did when the slugs were constants. Host
 * code uses `collectionSlugsOf`, whose `string` slugs match whatever the host registered.
 */
export const pluginSlugsOf = (payload: Payload): typeof DEFAULT_COLLECTION_SLUGS =>
	collectionSlugsOf(payload) as unknown as typeof DEFAULT_COLLECTION_SLUGS

export const votedCookiePrefixOf = (payload: Payload): string =>
	customStateOf<SlugState>(payload).votedCookiePrefix ?? DEFAULT_VOTED_COOKIE_PREFIX
