import type { KeysConfig } from '@10x-media/fields/encrypted'
import type {
	Access,
	CollectionConfig,
	CollectionSlug,
	Field,
	Payload,
	PayloadRequest,
	RawPayloadComponent,
	Widget,
} from 'payload'
import type { AnalyticsBinding, ResolvedBinding } from '../binding/types'
import type { GoalCollectionFieldOverrides } from '../goals/collection'
import type { CurrencyConverter } from '../goals/currency'
import type { BrowserAmounts, OrderSignatureMode } from '../goals/match'
import type { Goal } from '../goals/types'
import type { TrustedPlatform } from '../net/platform'
import { type RouteBase, resolveRouteBase } from '../plugin/routes'
import type { ScopeDecision } from '../plugin/runtime'
import type {
	ConnectionAccess,
	ConnectionFieldAccess,
	ProviderCollectionFieldOverrides,
} from '../providers/collection'
import type { ProviderHostPolicy } from '../providers/hosts'
import type { AfterReadHook } from '../surfacing/afterRead'
import type { CacheStore } from '../surfacing/cacheStore'
import type { TimeframePreset } from '../timeframe/presets'
import { isValidTimeZone } from '../timeframe/tz'
import type {
	CaptureClientKind,
	CaptureSlot,
	ResolvedAutoCapture,
	TrackerSkip,
} from '../tracker/config'
import type { TranslationsOption } from '../translations'
import { keys, pluralKeys } from '../translations/keys'
import type { CustomWidgetDef } from '../widgets/customWidget'
import { resolveCountryFlags, resolveView, resolveWidgets } from './adminOptions'
import { resolveCache, resolveHooks, resolveSync } from './cacheOptions'
import { resolveCapture, resolveTrust } from './captureOptions'
import type {
	AnalyticsCollectionOptions,
	CollectionOverrides,
	ResolvedCollectionOption,
	ResolvedScopedCollection,
} from './collectionOption'
import type { AnalyticsAdapter, MetricKey } from './contract'
import type { FetchLike } from './fetch'
import { resolveGoals, resolveRevenue } from './goalOptions'
import { type AnalyticsJobsOptions, assertJobsFit, type ResolvedJobs, resolveJobs } from './jobs'
import { assertNoLegacyOptions } from './legacyOptions'
import {
	flatFieldName,
	keysOf,
	optionalBoolean,
	optionalFunction,
	optionsObject,
} from './optionChecks'
import { assertScopedOnlyOptions, resolveAccess, resolveScope } from './scopeOptions'
import { type AnalyticsSdks, resolveSdks } from './sdks'
import { assertAdapters, assertNamesAdapter, resolveProviders } from './sourceOptions'
import { isRecord, kindOf, listOf } from './values'
import type { BuiltInWidgetSlug } from './widgetSlugs'

export { DEFAULT_VIEW } from './adminOptions'
export { fillableSlots, trackerAutoCapture, untrustedAddressNotice } from './captureOptions'
export type { AnalyticsCollectionOptions, CollectionOverrides } from './collectionOption'
export { revenueOffWarning } from './goalOptions'
export type { AnalyticsJobsOptions, AnalyticsTaskOptions } from './jobs'
export { allCrossScope } from './scopeOptions'
export type { CurrencyConverter }

/** The multi-tenant plugin's own relationship field, which a scoped install almost always has. */
export const DEFAULT_BINDING_SCOPE_FIELD = 'tenant'

/**
 * Who asks for a request's scope: `capture` files a visitor's hit and carries no user or cookies,
 * so it resolves from the host; `admin` is every signed-in read or edit.
 */
export type ScopeCallSite = 'capture' | 'admin'

/**
 * Maps a request to the scope it selected (tenant id, site key), null for the whole install;
 * whether its user may act there is `scope.member`. `'*'` is refused.
 */
export type ScopeResolver = (args: {
	req: PayloadRequest
	callSite: ScopeCallSite
}) => string | null | Promise<string | null>

/**
 * Lists the tenant scopes the sync task runs over, in addition to the install-wide scope it always
 * covers. Warming needs no list: it repeats the reads each scope's readers made.
 */
export type ScopeListResolver = (args: { payload: Payload }) => string[] | Promise<string[]>

/**
 * Names a scope on screen, so a tenant admin reads a name rather than an id in the view's caption.
 * Undefined keeps the id.
 */
export type ScopeLabelResolver = (args: {
	req: PayloadRequest
	scope: string
}) => string | undefined | Promise<string | undefined>

/** Whether the request's user belongs to `scope`, as opposed to having merely selected it. */
export type ScopeMemberAccess = (args: {
	req: PayloadRequest
	scope: string
}) => boolean | Promise<boolean>

/** How the install divides its analytics into tenants. Unset, the install is one scope. */
export type AnalyticsScopeOptions = {
	resolve: ScopeResolver
	/**
	 * Whether the request's user belongs to the scope `resolve` selected, asked on every read and
	 * config write. `tenantMembership()` reads the multi-tenant plugin's tenants.
	 */
	member: ScopeMemberAccess
	list?: ScopeListResolver
	label?: ScopeLabelResolver
}

/**
 * Resolves a scope's IANA reporting timezone, also asked at ingest without the user or cookies.
 * Null means UTC.
 */
export type TimezoneResolver = (args: {
	req: PayloadRequest
	scope: string | null
}) => string | null | Promise<string | null>

/**
 * Resolves a scope's ISO 4217 revenue currency, so each tenant can have its own. Undefined reports
 * revenue as a plain number.
 */
export type CurrencyResolver = (args: {
	req: PayloadRequest
	scope: string | null
}) => string | undefined | Promise<string | undefined>

/**
 * How the install measures money once `revenue` turns it on. Off hides every money surface but
 * keeps stored data, so turning it on later reports the history.
 */
export type AnalyticsRevenueOptions = {
	/**
	 * ISO 4217 currency revenue is reported in, or a resolver per tenant. Unset, amounts are summed
	 * as sent and a mix of currencies is flagged in `meta.mixedCurrencies`.
	 */
	currency?: string | CurrencyResolver
	/**
	 * FX hook native ingest calls when an event's currency differs from `currency`. Without it such
	 * an amount stays out of revenue, though the conversion still counts.
	 */
	convert?: CurrencyConverter
	/**
	 * The `currency` breakdown dimension, keyed by the currency each amount was sent in. Default: on
	 * while no `convert` hook is set.
	 */
	dimension?: boolean
	/**
	 * How far native ingest trusts an amount a browser sends, which anyone can forge. `'fixed'`
	 * (default) prefers a goal's fixed value, `'none'` ignores it, `'trust'` prefers it.
	 */
	browserAmounts?: BrowserAmounts
	/**
	 * Whether native ingest takes an order id sent without the server's `signOrderId` signature.
	 * `'optional'` (default) takes it; `'required'` answers an unsigned one with `400`.
	 */
	orderSignature?: OrderSignatureMode
}

/** What `providers.resolve` is handed for one scope. */
export interface ProvidersResolveArgs {
	payload: Payload
	req?: PayloadRequest
	scope: string | null
	/**
	 * The runtime's guarded fetch: every address a vendor's host resolves to has to be public, on
	 * every connection and every redirect. Hand it to `adapterFromProviderDoc`.
	 */
	fetch: FetchLike
	/**
	 * The hosts a document may name: each vendor's own cloud, plus `providers.hosts`. Hand it to
	 * `adapterFromProviderDoc` with `fetch`, which reaches a private network only when it allows one.
	 */
	hosts: ProviderHostPolicy
	/** The plugin's `sdks`, which a GA4 document's adapter reads through. */
	sdks: AnalyticsSdks
}

/**
 * Replaces the providers collection lookup with a scope's adapters, uncached. Build each with
 * `adapterFromProviderDoc(row, { fetch, hosts, sdks })` so a stored key reaches allowed hosts only.
 */
export type ProvidersResolve = (
	args: ProvidersResolveArgs
) => AnalyticsAdapter[] | Promise<AnalyticsAdapter[]>

/**
 * Where provider documents may point. Each vendor's own cloud is always allowed: Plausible, Umami
 * Cloud, and PostHog's US and EU regions.
 */
export type ProviderHostsOptions = {
	/**
	 * Origins a document's host may name besides its vendor's cloud, such as `https://*.example.com`;
	 * no paths. A host outside them reads as `source_misconfigured`.
	 */
	allow?: string[]
	/**
	 * Lets document adapters reach any address over http or https, private networks included (Umami
	 * on the same Docker network). Default off.
	 */
	allowPrivateNetwork?: boolean
}

export type ProvidersCollectionOptions = {
	slug?: string
	/**
	 * Field matched against the resolved scope when looking up a scope's providers. Default `scope`;
	 * name a tenant plugin's field (`tenant`) when that plugin scopes the collection.
	 */
	scopeField?: string
	/**
	 * Replaces one of the collection's own fields, each handed the plugin's default. Applied before
	 * `overrides`.
	 */
	fields?: ProviderCollectionFieldOverrides
	/**
	 * Reshapes the whole config last. It may not rename the collection (`slug` does) nor turn off
	 * its timestamps, which every instance notices a saved document by: the boot refuses both.
	 */
	overrides?: CollectionOverrides
	access?: Partial<CollectionConfig['access']>
	/**
	 * Dedicated key ring for stored provider credentials. Unset, the fields plugin's `encrypted.keys`
	 * applies, else a ring derived from the Payload secret, fit for dev only.
	 */
	encryption?: { keys?: KeysConfig }
	/**
	 * Who may set or change where a document connects (provider, host, ids); a denied value is
	 * dropped. Default: the creator, then `access.crossScope.named` when scoped, else update access.
	 */
	connectionAccess?: ConnectionAccess
	/**
	 * Which provider documents a reader reads analytics through, as collection access ANDed with
	 * enabled and scope. Default: the collection's own read access.
	 */
	sourceAccess?: Access
}

export type ProvidersOptions = {
	/** Opt-in admin collection storing runtime provider configurations. */
	collection?: boolean | ProvidersCollectionOptions
	/** Replaces the collection: the two cannot both be set. */
	resolve?: ProvidersResolve
	/** Where the documents of either one may point. Needs `collection` or `resolve`. */
	hosts?: ProviderHostsOptions
}

/** Access checker for authenticated analytics reads. */
export type AnalyticsReadAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

/** Access checker for the analytics admin view. */
export type AnalyticsViewAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

/** Access checker for one of the cross-scope gates under `access.crossScope`. */
export type CrossScopeAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

/**
 * The three ways a reader on a scoped install reaches past their own scope, each denied by default.
 * Split so platform staff can aggregate without singling out one tenant.
 */
export type AnalyticsCrossScopeOptions = {
	/**
	 * Reading a scope the request does not resolve to, by naming it. Also decides who manages other
	 * tenants' provider, goal and sync documents.
	 */
	named?: CrossScopeAccess
	/** Reading every scope at once: the `'*'` marker, and a scoped install's null scope. */
	aggregate?: CrossScopeAccess
	/**
	 * Reading a tenant through a shared config adapter that cannot narrow its query to one scope.
	 * Also decides whether such an adapter is listed as a source at all.
	 */
	unscopedSource?: CrossScopeAccess
}

export type AnalyticsAccessOptions = {
	/**
	 * Gates every read: endpoints, dashboard widgets and display fields. Default `isAdminUser` (the
	 * `admin.user` collection); scope gating applies on top and is never widened by it.
	 */
	read?: AnalyticsReadAccess
	/**
	 * Gates the analytics admin view. Default: `read`. A denied reader still sees the nav link and
	 * lands on the view's no-access message.
	 */
	view?: AnalyticsViewAccess
	/**
	 * Reads past the request's own scope, scoped installs only: a function grants all three gates,
	 * the object form each one (unset denies). Unscoped, all three open to `isAdminUser`.
	 */
	crossScope?: CrossScopeAccess | AnalyticsCrossScopeOptions
}

/** The three cross-scope gates, each filled. */
export type ResolvedCrossScope = Record<ScopeDecision, CrossScopeAccess>

/** What `capture.gate` is asked about one capture slot. */
export interface CaptureGateArgs {
	slot: CaptureSlot
	/** The adapter filling the slot for this request. */
	adapterId: string
	kind: CaptureClientKind
}

/**
 * Which capture slots wait for the host's consent manager: `'all'`, `'off'`, a list of slots, or a
 * function answering per slot (true waits).
 */
export type CaptureGate = 'all' | 'off' | CaptureSlot[] | ((args: CaptureGateArgs) => boolean)

/** `capture.gate` resolved: whether one slot, filled by one adapter, waits. */
export type CaptureGatePolicy = (args: CaptureGateArgs) => boolean

/** An adapter id to fill a capture slot with, or `false` to leave it deliberately empty. */
export type CaptureSlotOption = string | false

/** What the tracker and ingest do with elements marked by `itemAttributes`. */
export type ItemCaptureOptions = {
	/** Count an item as seen once at least half of it stays on screen for a second. */
	impressions?: boolean
	/** Send `item_click` for the first click on an item during a pageview. */
	clicks?: boolean
	/** Also count an item per page it appeared on, beside its own total. */
	pages?: boolean
}

export type AutoCaptureOptions = {
	scrollDepth?: boolean
	outboundLinks?: boolean
	fileDownloads?: boolean
	goalAttribute?: boolean
	/**
	 * Send each pageview's query string so ingest can extract its utm keys. The raw query is
	 * never stored, only the five campaign values; set false to stop sending it at all.
	 */
	query?: boolean
	/**
	 * Content items, on by default and inert until a page marks an element with `itemAttributes`.
	 * `false` turns them off, crediting goals to items included.
	 */
	items?: false | ItemCaptureOptions
}

export type AnalyticsGoalsCollectionOptions = {
	slug?: string
	/**
	 * Field matched against the resolved scope when looking up a scope's goals. Point it at
	 * a tenant plugin's field (e.g. 'tenant') when that plugin manages scoping.
	 */
	scopeField?: string
	/**
	 * Replaces one of the collection's own fields, each handed the plugin's default; applied before
	 * `overrides`. A `slug` replacement must keep a field named `slug` or the boot fails.
	 */
	fields?: GoalCollectionFieldOverrides
	/**
	 * Reshapes the whole config last. It may not rename the collection (`slug` does) nor turn off
	 * its timestamps, which every instance notices a saved document by: the boot refuses both.
	 */
	overrides?: CollectionOverrides
	access?: Partial<CollectionConfig['access']>
}

/** Goals as config, plus the opt-in collection editors manage their own goals through. */
export type AnalyticsGoalsOptions = {
	defaults?: Goal[]
	/** Opt-in admin collection whose goals merge over `defaults`, by slug, per scope. */
	collection?: boolean | AnalyticsGoalsCollectionOptions
	/**
	 * The built-in `purchase` goal sales book against, on unless a configured goal claims that slug.
	 * `false` removes it, for an install that never sells.
	 */
	purchase?: boolean
}

/**
 * A scope's own site addresses where its exclusion link opens, each an `http(s)` origin with an
 * optional path. Scope is null on an unscoped install.
 */
export type ExclusionSitesResolver = (args: {
	req: PayloadRequest
	scope: string | null
}) => string[] | Promise<string[]>

/** The signed link staff open to leave their own browser out of the numbers. */
export type AnalyticsExclusionOptions = {
	/**
	 * The query parameter the tracker reads. Default `analytics_exclude`. Letters, digits, `.`,
	 * `_`, `~` and `-`, at most 64 of them.
	 */
	param?: string
	/**
	 * Where the scope's sites run, so the view hands out each site's whole link: a list, or a
	 * function per scope. Unset, the view hands out only the part to add to a site's address.
	 */
	sites?: string[] | ExclusionSitesResolver
}

export type AnalyticsCaptureOptions = {
	/**
	 * Which capture slots wait for the host's consent manager. Required whenever a slot can fill:
	 * whether tracking needs consent is the operator's call, so there is no default.
	 */
	gate?: CaptureGate
	/**
	 * Exact origins of other sites (`https://shop.example.com`, no path or wildcard) whose pages may
	 * send to ingest and the capture proxy. Unset, only the site and its subdomains can.
	 */
	allowedOrigins?: string[]
	/**
	 * The signed link staff open to leave their browser out of the numbers. Off by default; `true`
	 * turns it on as `analytics_exclude`, an object renames it through `param`.
	 */
	exclusion?: boolean | AnalyticsExclusionOptions
	/**
	 * Which adapter fills each slot (`global`: `platformAdapter` or the only adapter; `tenant`: the
	 * scope's default). `false` leaves a slot empty: no proxy mount, no tracker entry.
	 */
	slots?: { global?: CaptureSlotOption; tenant?: CaptureSlotOption }
	/**
	 * Mount each slot's snippet points at. Default: the runtime proxy endpoint; set it to a
	 * `captureRoute` handler's path, without the Next `basePath`, which the tracker config adds.
	 */
	paths?: { global?: string; tenant?: string }
	/** Browser auto-capture listeners, all on by default except `scrollDepth`. */
	autoCapture?: AutoCaptureOptions
	/**
	 * Pages the tracker leaves uncounted, each on unless false: `automation` (`navigator.webdriver`;
	 * turn it off for e2e suites asserting on hits) and `previews` (draft mode, live preview).
	 */
	skip?: { automation?: boolean; previews?: boolean }
	/** Limits for the public runtime capture proxy, separate from the read-path `cache`. */
	proxy?: {
		/**
		 * Deadline for the upstream response headers, in ms. Default 10000. The body
		 * download is not on the clock, so a large tracker bundle streams to completion.
		 */
		timeoutMs?: number
		/**
		 * Largest proxied request body, in bytes. Default 1 MiB, which clears a PostHog
		 * batch carrying session-replay data. Anything larger is refused with 413.
		 */
		maxBodyBytes?: number
	}
}

export type AnalyticsViewOptions = {
	/** Admin path the view mounts at, under `routes.admin`. Default `/analytics`. */
	path?: `/${string}`
	/** Timeframe the view opens on before the URL says otherwise. Default `last30days`. */
	defaultRange?: TimeframePreset
	/** Metric the cards and the trend open on. Default `pageviews`. */
	defaultMetric?: MetricKey
	/**
	 * Nav link label. A string is used as-is; a map is keyed by admin language code and
	 * falls back to `en`. Unset, the plugin's own translated label applies.
	 */
	navLabel?: string | Record<string, string>
	/**
	 * A client component replacing the view's body under the same server shell, given
	 * `AnalyticsViewClientProps`; compose it from the sections `@10x-media/analytics/client` exports.
	 *
	 * @beta
	 */
	Component?: AnalyticsComponent
}

export interface ResolvedView {
	path: `/${string}`
	defaultRange: TimeframePreset
	defaultMetric: MetricKey
	navLabel?: string | Record<string, string>
	Component?: AnalyticsComponent
}

/**
 * A component a host puts in one of the plugin's places, as Payload takes one: an import-map path
 * such as `'/components/Flag#Flag'`, or the object form with its export and props.
 *
 * @beta
 */
export type AnalyticsComponent = string | RawPayloadComponent

/**
 * How a host changes one built-in dashboard widget.
 *
 * @beta
 */
export interface AnalyticsWidgetOverride {
	/**
	 * Rendered in place of the plugin's own component. A server component receives the full widget
	 * props, a client component its `clientProps` alone.
	 */
	Component?: AnalyticsComponent
	/** The widget's name in the dashboard's widget list. */
	label?: Widget['label']
	/**
	 * The widget's settings, given the plugin's own fields as `defaultFields`, the shape Payload's
	 * form builder and search plugins take; what it returns is the form.
	 */
	fields?: (args: { defaultFields: Field[] }) => Field[]
}

/** @beta */
export type AnalyticsWidgetOverrides = Partial<Record<BuiltInWidgetSlug, AnalyticsWidgetOverride>>

/** @beta */
export interface AnalyticsWidgetsOptions {
	disabled?: string[]
	register?: CustomWidgetDef[]
	/**
	 * Marks each widget's free-text Title field `localized`. Default off; takes effect only when the
	 * Payload config enables localization.
	 */
	localizeText?: boolean
	/**
	 * Period-over-period comparison on the metric and trend widgets. Default on, except for a source
	 * whose adapter sets `capabilities.comparison` false; `false` skips the second read.
	 */
	comparison?: boolean
	/** Built-in widgets changed by slug: their component, their name, their settings. */
	overrides?: AnalyticsWidgetOverrides
}

/**
 * `countryFlags` with a flag of the host's own.
 *
 * @beta
 */
export interface AnalyticsCountryFlags {
	/**
	 * A client component drawing one flag from `{ code }`, an ISO 3166-1 alpha-2 code in capitals.
	 * Registered through `admin.dependencies`, so `payload generate:importmap` picks it up.
	 */
	Component: AnalyticsComponent
}

/** The collection the sync job persists daily metrics into: `slug` defaults to `analytics-daily`. */
export type AnalyticsSyncCollectionOptions = AnalyticsCollectionOptions & {
	/** Keeps the collection out of the admin nav. Default true. */
	hidden?: boolean
}

/** The read cache's collection: `slug` defaults to `analytics-cache`. */
export type AnalyticsCacheCollectionOptions = AnalyticsCollectionOptions

/** What `analytics-sync` copies; when it runs is `jobs.tasks.sync`. */
export type AnalyticsSyncOptions = {
	/** Days each run reads back, today counted. Default 3. */
	lookbackDays?: number
	/**
	 * The sources it copies: a config adapter's id, or a provider type for every source built from
	 * provider documents of that type. Default every vendor source.
	 */
	adapters?: string[]
	collection?: AnalyticsSyncCollectionOptions
}

/** How much reads may ask of their sources at once (`cache.concurrency`). */
export type AnalyticsConcurrencyOptions = {
	/** Requests in flight across every vendor source of one instance. Default 16. */
	global?: number
	/** Requests in flight per vendor source that declares no `rateLimit.maxConcurrent`. Default 4. */
	perSource?: number
	/** Reads with nothing cached one scope may have waiting on its sources. Default 8. */
	perScope?: number
}

/** How reads are cached, how long they wait for their sources, and which are kept warm. */
export type AnalyticsCacheOptions = {
	/**
	 * Seconds an answer stays fresh; unset, each adapter's `recommendedTtl` applies. A native read
	 * whose window reaches into today stays fresh 10 seconds at most whatever this says.
	 */
	ttl?: { aggregate?: number; realtime?: number }
	/**
	 * Keeps recently asked reads warm: `analytics-warm` rereads each shortly before its cached answer
	 * expires. Default off; `true` uses the defaults. Scheduled by `jobs.tasks.warm`.
	 */
	warm?: boolean | AnalyticsWarmOptions
	/**
	 * How long a read waits for its source, in ms, retries included. Default 15000. Only a read with
	 * nothing cached (and sync) waits; others answer an expired entry at once.
	 */
	timeoutMs?: number
	/**
	 * How much reads may ask of their sources at once; past `perScope` the query endpoint answers
	 * 429. Native reads have a lane of their own outside these: 8, or on Postgres a third of
	 * `pool.max`, between 1 and 8.
	 */
	concurrency?: AnalyticsConcurrencyOptions
	/**
	 * Where reads are cached across requests and instances. Default: the `analytics-cache`
	 * collection; a self-expiring store (Redis) replaces it. Live counts stay in memory.
	 */
	store?: CacheStore
	/** The `analytics-cache` collection of the default store; refused beside `store`. */
	collection?: AnalyticsCacheCollectionOptions
}

/** Hooks into what the plugin does. */
export type AnalyticsHooksOptions = {
	/**
	 * Runs once for every read answered to a reader, after it is cached, to observe it or answer
	 * that one read differently. See {@link AfterReadHook} for the contract.
	 */
	afterRead?: AfterReadHook
}

/** Which reads `analytics-warm` keeps warm; when it runs is `jobs.tasks.warm`. */
export type AnalyticsWarmOptions = {
	/** Reads asked for in this many hours count as recent. Default 24. */
	windowHours?: number
	/** The most reads one run refreshes, most recently read first. Default 200. */
	maxReads?: number
}

/** Where the plugin's endpoints answer. */
export type AnalyticsRoutesOptions = {
	/**
	 * The path every plugin endpoint hangs off, under `routes.api`. Default `/_x`; the boot fails
	 * when a collection slug is its first segment, which would swallow those requests.
	 */
	base?: RouteBase
}

export type AnalyticsPluginOptions = {
	/**
	 * Switches the plugin off but keeps its schema (collections, fields, indexes, task slugs), so
	 * nothing is dropped. No endpoint, view, widget or task work runs; options are still checked.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for the plugin's UI strings, keyed by `@10x-media/analytics/i18n` keys.
	 * They win per key over built-ins; app `i18n.translations` wins over both.
	 */
	translations?: TranslationsOption
	adapters: AnalyticsAdapter[]
	defaultAdapter?: string
	/**
	 * Id of one config adapter shared by every scope (the platform's own analytics). Reading a tenant
	 * through it needs `access.crossScope.unscopedSource` unless it supports scoped queries.
	 */
	platformAdapter?: string
	/** Tenancy: how a request maps to its scope. Unset, the whole install is one scope. */
	scope?: AnalyticsScopeOptions
	/**
	 * IANA timezone days are cut in. Default UTC; a resolver answers per scope. After a change,
	 * native recounts in the new zone only days whose raw hits it still keeps.
	 */
	reportingTimezone?: string | TimezoneResolver
	/**
	 * Money as a capability. `false` or unset measures none; `true` measures it with the
	 * defaults; an object turns it on and says in which currency, and how.
	 */
	revenue?: boolean | AnalyticsRevenueOptions
	/**
	 * How many proxies to trust, counted from the right of `x-forwarded-for`, when reading a client
	 * address. Unset keeps the leftmost entry, which the client controls. Not with `trustedPlatform`.
	 */
	trustedProxyHops?: number
	/**
	 * Platform (`'vercel'` or `'cloudflare'`) whose edge headers carry the visitor's address and
	 * location. Set it only when every request passes through it, or the headers can be forged.
	 */
	trustedPlatform?: TrustedPlatform
	access?: AnalyticsAccessOptions
	capture?: AnalyticsCaptureOptions
	/**
	 * Conversion goals the tracker and native ingest match events against: a list, or `{ defaults,
	 * collection, purchase }`. A goal's name never reaches the browser.
	 */
	goals?: Goal[] | AnalyticsGoalsOptions
	/**
	 * Per-collection bindings, keyed by collection slug. With generated types
	 * augmented, each slug's resolvers receive that collection's typed document.
	 */
	collections?: { [TSlug in CollectionSlug]?: AnalyticsBinding<TSlug> }
	providers?: ProvidersOptions
	/**
	 * The analytics admin view and its nav link, on by default. `false` registers neither;
	 * the read endpoints stay mounted either way, so a custom surface keeps working.
	 */
	view?: false | AnalyticsViewOptions
	/**
	 * Dashboard widgets, on by default. Payload's dashboard is experimental, so this option is too.
	 *
	 * @beta
	 */
	widgets?: boolean | AnalyticsWidgetsOptions
	/**
	 * Flag beside country names in the view, widgets and document panel. Default on, served by the
	 * plugin's cached route; `false` shows none, `{ Component }` draws the host's own.
	 *
	 * @beta
	 */
	countryFlags?: boolean | AnalyticsCountryFlags
	cache?: AnalyticsCacheOptions
	/**
	 * Opt-in sync tier: `analytics-sync` copies each vendor source's daily metrics into a queryable
	 * collection, every six hours unless `jobs.tasks.sync` says otherwise.
	 */
	sync?: boolean | AnalyticsSyncOptions
	routes?: AnalyticsRoutesOptions
	/**
	 * The plugin's tasks (maintain, sync, warm) on `jobs.queue`, scheduled by `jobs.tasks`. `false`
	 * registers none: reads and ingest then do native upkeep, and sync or warming is refused.
	 */
	jobs?: false | AnalyticsJobsOptions
	/**
	 * Optional packages handed in, which a standalone or serverless build then ships: GA4's
	 * `{ BetaAnalyticsDataClient }` and MaxMind's `{ open }`. A production boot warns about one missing.
	 */
	sdks?: AnalyticsSdks
	hooks?: AnalyticsHooksOptions
}

/** `capture.exclusion` while the link is on. */
export interface ResolvedExclusion {
	param: string
	/** `sites`, a list made a function answering it; absent when the install names none. */
	sites?: ExclusionSitesResolver
}

export interface ResolvedCapture {
	slots: { global?: CaptureSlotOption; tenant?: CaptureSlotOption }
	paths: { global?: string; tenant?: string }
	gate: CaptureGatePolicy
	autoCapture: ResolvedAutoCapture
	proxy: { timeoutMs: number; maxBodyBytes: number }
	/** `allowedOrigins`, each as a browser writes it in `Origin`. */
	allowedOrigins: ReadonlySet<string>
	/** The exclusion link's parameter and site addresses, or false while the link is off. */
	exclusion: false | ResolvedExclusion
	skip: TrackerSkip
}

export interface ResolvedRevenue {
	/** Whether the install measures money at all. Every money surface reads this one answer. */
	enabled: boolean
	/** Raw currency option; the plugin normalizes it into a resolver. */
	currency?: string | CurrencyResolver
	convert?: CurrencyConverter
	/** Whether native declares the `currency` dimension; always false while money is off. */
	dimension: boolean
	browserAmounts: BrowserAmounts
	orderSignature: OrderSignatureMode
}

export interface ResolvedScope {
	/** The host's resolver with `'*'` refused; resolves null for every request when unscoped. */
	resolve: ScopeResolver
	list?: ScopeListResolver
	label?: ScopeLabelResolver
	/** Present exactly when the install is scoped. */
	member?: ScopeMemberAccess
}

export interface ResolvedOptions {
	adapters: AnalyticsAdapter[]
	defaultAdapter?: string
	scope: ResolvedScope
	/** True when the app configured `scope.resolve` (scoped install). */
	scoped: boolean
	/** Raw `reportingTimezone`, a string already validated; the runtime makes it a resolver. */
	reportingTimezone?: string | TimezoneResolver
	revenue: ResolvedRevenue
	platformAdapter?: string
	/** Raw trustedProxyHops option; undefined keeps the leftmost forwarded-for entry. */
	trustedProxyHops?: number
	/** The platform whose edge headers are believed; undefined believes none. */
	trustedPlatform?: TrustedPlatform
	access: {
		read: AnalyticsReadAccess
		view: AnalyticsViewAccess
		crossScope: ResolvedCrossScope
	}
	/** The admin view, filled with its defaults, or false when the app turned it off. */
	view: false | ResolvedView
	/** `true` the plugin's own flags, `false` none, or the host's component. */
	countryFlags: boolean | AnalyticsCountryFlags
	capture: ResolvedCapture
	/** Config goals, validated; the goals collection layers its own on top of these. */
	goals: Goal[]
	/** `goals.purchase`: whether the resolver adds the built-in `purchase` goal. */
	purchaseGoal: boolean
	goalsCollection: ResolvedScopedCollection<GoalCollectionFieldOverrides>
	providers: {
		collection: ResolvedScopedCollection<ProviderCollectionFieldOverrides> & {
			encryption?: { keys?: KeysConfig }
			connectionAccess?: ConnectionFieldAccess
			sourceAccess?: Access
		}
		resolve?: ProvidersResolve
		/** `providers.hosts`, for the collection's documents and the rows `resolve` reads alike. */
		hosts: ProviderHostPolicy
	}
	/** Each binding with its `scopeField` filled. */
	bindings: Record<string, ResolvedBinding>
	cache: {
		/** Undefined when unset: adapter recommendedTtl is the fallback, an explicit value wins. */
		ttl: { aggregate?: number; realtime?: number }
		warm: { enabled: boolean; windowHours: number; maxReads: number }
		timeoutMs: number
		concurrency: { global: number; perSource: number; perScope: number }
		/** The host's store; absent, the `analytics-cache` collection is the store. */
		store?: CacheStore
		/** The default store's collection, used only while `store` is absent. */
		collection: ResolvedCollectionOption
	}
	widgets: {
		enabled: boolean
		disabled: string[]
		register: CustomWidgetDef[]
		localizeText: boolean
		comparison: boolean
		overrides: AnalyticsWidgetOverrides
	}
	sync: {
		enabled: boolean
		lookbackDays: number
		adapters?: string[]
		collection: ResolvedCollectionOption & {
			hidden: boolean
		}
	}
	routes: { base: RouteBase }
	jobs: ResolvedJobs
	sdks: AnalyticsSdks
	hooks: { afterRead?: AfterReadHook }
}

const PLUGIN_KEYS = keysOf<AnalyticsPluginOptions>({
	disabled: true,
	translations: true,
	adapters: true,
	defaultAdapter: true,
	platformAdapter: true,
	scope: true,
	reportingTimezone: true,
	revenue: true,
	trustedProxyHops: true,
	trustedPlatform: true,
	access: true,
	capture: true,
	goals: true,
	collections: true,
	providers: true,
	view: true,
	widgets: true,
	countryFlags: true,
	cache: true,
	sync: true,
	routes: true,
	jobs: true,
	sdks: true,
	hooks: true,
})
const ROUTES_KEYS = keysOf<AnalyticsRoutesOptions>({ base: true })
const BINDING_KEYS = keysOf<AnalyticsBinding>({
	path: true,
	pathField: true,
	hostname: true,
	item: true,
	scopeField: true,
})

/** Every key the plugin's own translations override, singular and plural forms alike. */
const TRANSLATION_KEYS: ReadonlySet<string> = new Set<string>([
	...Object.values(keys),
	...Object.values(pluralKeys).flatMap((forms) => Object.values(forms)),
])

/** `translations`: per language, strings keyed by the plugin's own translation keys. */
const assertTranslations = (option: unknown): void => {
	if (option === undefined) {
		return
	}
	if (!isRecord(option) || Array.isArray(option)) {
		throw new Error(
			`analytics: translations must be an object keyed by language, such as { de: { 'analytics:viewTitle': 'Statistik' } }, got ${kindOf(option)}`
		)
	}
	for (const [language, strings] of Object.entries(option)) {
		if (!isRecord(strings) || Array.isArray(strings)) {
			throw new Error(
				`analytics: translations.${language} must be an object of strings keyed by translation key, got ${kindOf(strings)}`
			)
		}
		for (const [key, text] of Object.entries(strings)) {
			if (!TRANSLATION_KEYS.has(key)) {
				throw new Error(
					`analytics: translations.${language}["${key}"] is not one of the plugin's translation keys, which @10x-media/analytics/i18n exports as keys`
				)
			}
			if (text !== undefined && typeof text !== 'string') {
				throw new Error(
					`analytics: translations.${language}["${key}"] must be a string, got ${kindOf(text)}`
				)
			}
		}
	}
}

/** `reportingTimezone`: an IANA name checked at boot, or a resolver answering per scope. */
const assertTimezone = (option: unknown): void => {
	if (option !== undefined && typeof option !== 'string' && typeof option !== 'function') {
		throw new Error(
			`analytics: reportingTimezone must be an IANA timezone or a function, got ${kindOf(option)}`
		)
	}
	if (typeof option === 'string' && !isValidTimeZone(option)) {
		throw new Error(
			`analytics: reportingTimezone "${option}" is not an IANA timezone name, such as "Europe/Berlin"`
		)
	}
}

/** One `collections` entry: how a bound document's page is found, and whether it is an item. */
const assertBinding = (binding: unknown, slug: string): void => {
	const at = `collections.${slug}`
	const shaped = optionsObject(binding, {
		path: at,
		known: BINDING_KEYS,
		example: "an object such as { pathField: 'slug' }",
	})
	optionalFunction(shaped.path, `${at}.path`)
	if (
		shaped.pathField !== undefined &&
		(typeof shaped.pathField !== 'string' || shaped.pathField.trim() === '')
	) {
		throw new Error(
			`analytics: ${at}.pathField must be a field name, got ${kindOf(shaped.pathField)}`
		)
	}
	if (
		shaped.hostname !== undefined &&
		typeof shaped.hostname !== 'string' &&
		typeof shaped.hostname !== 'function'
	) {
		throw new Error(
			`analytics: ${at}.hostname must be a hostname or a function answering one, got ${kindOf(shaped.hostname)}`
		)
	}
	optionalBoolean(shaped.item, `${at}.item`)
	if (!shaped.path && !shaped.pathField && shaped.item !== true) {
		throw new Error(
			`analytics: binding for "${slug}" needs a path resolver, a pathField, or item: true`
		)
	}
	if (shaped.item === true && slug.includes(':')) {
		throw new Error(
			`analytics: collection "${slug}" cannot be bound as an item: a ref is "<collection>:<id>", so the slug cannot hold a colon`
		)
	}
}

/**
 * Each binding with its scope field filled: `'tenant'` when scoped, else `false` (the request's own
 * scope). Whether that field exists is checked at init, after every plugin adds fields.
 */
const resolveBindings = (
	collections: AnalyticsPluginOptions['collections'],
	scoped: boolean
): Record<string, ResolvedBinding> => {
	const keyed: unknown = collections
	if (keyed !== undefined && (!isRecord(keyed) || Array.isArray(keyed))) {
		throw new Error(
			`analytics: collections must be an object keyed by collection slug, such as { pages: { pathField: 'slug' } }, got ${kindOf(keyed)}`
		)
	}
	const out: Record<string, ResolvedBinding> = {}
	for (const [slug, binding] of Object.entries(collections ?? {})) {
		if (!binding) continue
		assertBinding(binding, slug)
		const declared = binding.scopeField ?? (scoped ? DEFAULT_BINDING_SCOPE_FIELD : false)
		const scopeField =
			declared === false
				? false
				: flatFieldName(declared, {
						path: `collections.${slug}.scopeField`,
						reason: "a document's scope is read from one of its own top-level fields",
					})
		// Erases the per-slug document generic: the runtime only hands a binding its own documents.
		out[slug] = { ...(binding as AnalyticsBinding), scopeField }
	}
	return out
}

const resolveRoutes = (option: AnalyticsPluginOptions['routes']): ResolvedOptions['routes'] => {
	if (option !== undefined) {
		optionsObject(option, {
			path: 'routes',
			known: ROUTES_KEYS,
			example: "an object such as { base: '/_x' }",
		})
	}
	return { base: resolveRouteBase(option?.base) }
}

/** `adapters`, and the options naming one of them by id. */
const assertAdapterOptions = (options: AnalyticsPluginOptions, requireAdapters: boolean): void => {
	assertAdapters(options.adapters)
	const adapters = options.adapters ?? []
	if (requireAdapters && adapters.length === 0) {
		throw new Error('analytics: at least one adapter is required')
	}
	if (adapters.length > 0) {
		assertNamesAdapter(options.defaultAdapter, 'defaultAdapter', adapters)
	}
	assertNamesAdapter(options.platformAdapter, 'platformAdapter', adapters)
}

/**
 * The options checked and filled. `requireAdapters: false` is the switched-off plugin's, which
 * reads through no adapter and only asks each for its schema.
 */
export function resolveOptions(
	options: AnalyticsPluginOptions,
	settings: { requireAdapters?: boolean } = {}
): ResolvedOptions {
	assertNoLegacyOptions(options)
	for (const key of Object.keys(options)) {
		if (!PLUGIN_KEYS.includes(key)) {
			throw new Error(
				`analytics: ${key} is not an option; analytics() takes ${listOf(PLUGIN_KEYS)}`
			)
		}
	}
	optionalBoolean(options.disabled, 'disabled')
	assertTranslations(options.translations)
	assertAdapterOptions(options, settings.requireAdapters !== false)
	const scope = resolveScope(options.scope)
	const scoped = options.scope?.resolve !== undefined
	if (!scoped) {
		assertScopedOnlyOptions(options)
	}
	const capture = resolveCapture(options, scoped)
	const access = resolveAccess(options.access, scoped)
	const trust = resolveTrust(options)
	assertTimezone(options.reportingTimezone)
	const countryFlags = resolveCountryFlags(options.countryFlags)
	const cache = resolveCache(options.cache)
	const sync = resolveSync(options.sync)
	const jobs = resolveJobs(options.jobs)
	assertJobsFit(jobs, { sync: sync.enabled, warm: cache.warm.enabled })
	return {
		adapters: options.adapters,
		defaultAdapter: options.defaultAdapter,
		scope,
		scoped,
		reportingTimezone: options.reportingTimezone,
		revenue: resolveRevenue(options.revenue),
		platformAdapter: options.platformAdapter,
		...trust,
		access,
		view: resolveView(options.view),
		countryFlags,
		capture,
		...resolveGoals(options.goals),
		providers: resolveProviders(options.providers),
		bindings: resolveBindings(options.collections, scoped),
		cache,
		widgets: resolveWidgets(options.widgets),
		sync,
		routes: resolveRoutes(options.routes),
		jobs,
		sdks: resolveSdks(options.sdks),
		hooks: resolveHooks(options.hooks),
	}
}
