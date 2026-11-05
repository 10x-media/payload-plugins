import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps, CollectionSlug, Params, Where } from 'payload'
import { parseCookies } from 'payload'
import { customEventTypeOptions, payloadAPILabels } from '../plugin/resolveOptions'
import { keys } from '../translations'
import { asTranslate } from '../translations/server'
import type {
	AuditLogsListSlotProps,
	AuditLogsRowSlotProps,
	AuditLogsSlotServerProps,
	AuditPluginConfig,
	CustomEventComponentProps,
} from '../types'
import { resolveCustomEventComponent } from '../utilities/customEventComponents'
import { isTenantGlobal, isTenantScoped } from '../utilities/tenantScope'
import { AuditLogsClient } from './AuditLogsClient'
import { authRedirectUrl } from './authRedirect'
import { filterConditions, parseFilters, splitRef } from './filterQuery'
import { PAYLOAD_INTERNAL_COLLECTIONS, PAYLOAD_INTERNAL_GLOBALS } from './internalEntities'
import type { RenderedEvents, RenderedRowSlots, SelectOption } from './types'
import { CUSTOM_FILTER_PREFIX, labelOf, resolveUser } from './utils'

export async function AuditLogsView({
	initPageResult,
	params,
	searchParams,
	pluginOptions,
	useTenant,
	forceWhere,
}: AdminViewServerProps & {
	pluginOptions: AuditPluginConfig
	useTenant?: boolean
	forceWhere?: Where
}) {
	const { req } = initPageResult
	const { user } = req
	const viewConfig = pluginOptions?.logs?.view !== false ? pluginOptions?.logs?.view : undefined
	const viewAccess = viewConfig?.access
	const configDefaultLimit = viewConfig?.defaultLimit ?? 25
	const multiTenancy = pluginOptions.multiTenancy === true ? {} : pluginOptions.multiTenancy

	const t = asTranslate(req.i18n.t)
	// Payload resolves both before rendering the view, so these are plain objects.
	const sp: Params = searchParams ?? {}

	const authRedirect: () => never = () =>
		redirect(authRedirectUrl({ config: req.payload.config, params, searchParams: sp, user }))

	if (!user) authRedirect()

	if (useTenant) {
		const tenantViewConfig = multiTenancy?.tenantView
		const tenantViewAccess =
			tenantViewConfig != null && tenantViewConfig !== true && tenantViewConfig !== false
				? tenantViewConfig.access
				: undefined
		if (tenantViewAccess) {
			const allowed = await tenantViewAccess({ req })
			if (!allowed) authRedirect()
		}
	} else if (viewAccess) {
		const allowed = await viewAccess({ req })
		if (!allowed) authRedirect()
	}

	// For tenant-scoped view: read current tenant from cookie
	let lockedTenantId: string | undefined
	if (useTenant && multiTenancy) {
		const cookies = parseCookies(req.headers)
		lockedTenantId = cookies.get('payload-tenant') ?? undefined
	}

	// If tenant view but no tenant selected, prompt user to select one
	if (useTenant && !lockedTenantId) {
		return (
			<DefaultTemplate
				i18n={req.i18n}
				locale={initPageResult.locale}
				params={params}
				payload={req.payload}
				permissions={initPageResult.permissions}
				searchParams={searchParams}
				user={user}
				visibleEntities={initPageResult.visibleEntities}
				req={req}
			>
				<Gutter>
					<p>{t(keys.selectTenant)}</p>
				</Gutter>
			</DefaultTemplate>
		)
	}

	const getString = (v: string | string[] | undefined): string | undefined =>
		Array.isArray(v) ? v[0] : v

	const page = Number(getString(sp.page)) || 1
	const limit = Number(getString(sp.limit)) || configDefaultLimit
	const customFilters = viewConfig?.filters ?? []
	const filters = parseFilters(sp, {
		customFilterNames: customFilters.map((f) => f.name),
		useTenant,
	})

	const { collections: collectionConfigs, globals: globalConfigs = [] } = req.payload.config
	const byLabel = (a: SelectOption, b: SelectOption) => a.label.localeCompare(b.label)
	// The tenant view offers only what can carry a tenant: tenant-scoped collections
	// and the tenants collection, with the per-tenant singletons as its globals. Real
	// globals never have a tenant, so it has none of those.
	const tenantFieldName = multiTenancy?.tenantFieldName ?? 'tenant'
	const tenantsSlug = multiTenancy?.tenantsSlug ?? 'tenants'
	const inTenantView = (c: (typeof collectionConfigs)[number]) =>
		c.slug === tenantsSlug ||
		(multiTenancy !== undefined &&
			isTenantScoped(
				c.slug,
				multiTenancy,
				c.fields.some((f) => 'name' in f && f.name === tenantFieldName)
			))
	const toOption = (c: (typeof collectionConfigs)[number]) => ({
		label: labelOf(c.labels?.plural, req.i18n) ?? c.slug,
		value: c.slug,
	})
	const offeredCollections = collectionConfigs.filter(
		(c) =>
			c.slug !== 'audit-logs' &&
			!PAYLOAD_INTERNAL_COLLECTIONS.includes(c.slug) &&
			(!useTenant || inTenantView(c))
	)
	const isSingleton = (slug: string) =>
		Boolean(useTenant && multiTenancy && isTenantGlobal(slug, multiTenancy))
	const collectionOptions = offeredCollections
		.filter((c) => !isSingleton(c.slug))
		.map(toOption)
		.sort(byLabel)
	const tenantGlobalOptions = offeredCollections
		.filter((c) => isSingleton(c.slug))
		.map(toOption)
		.sort(byLabel)
	// What a row calls its collection or global. Singular, since a row is one document.
	const collectionLabels = Object.fromEntries(
		collectionConfigs.map((c) => [c.slug, labelOf(c.labels?.singular, req.i18n) ?? c.slug])
	)
	const globalLabels = Object.fromEntries(
		globalConfigs.map((g) => [g.slug, labelOf(g.label, req.i18n) ?? g.slug])
	)
	const globalOptions = (useTenant ? [] : globalConfigs)
		.filter((g) => !PAYLOAD_INTERNAL_GLOBALS.includes(g.slug))
		.map((g) => ({ label: labelOf(g.label, req.i18n) ?? g.slug, value: g.slug }))
		.sort(byLabel)

	// Build useAsTitle map for auth collections
	const userTitleFields: Record<string, string> = {}
	for (const c of req.payload.config.collections) {
		if (c.auth) {
			userTitleFields[c.slug] = typeof c.admin?.useAsTitle === 'string' ? c.admin.useAsTitle : 'id'
		}
	}

	// Fetch tenant options for filter dropdown (super-admin view only)
	let tenantOptions: { label: string; value: string }[] | undefined
	if (multiTenancy && !useTenant) {
		// Configured by the host as a plain string, resolved here against the generated union.
		const tenantsSlug = (multiTenancy.tenantsSlug ?? 'tenants') as CollectionSlug
		const tenantCol = req.payload.config.collections.find((c) => c.slug === tenantsSlug)
		const useAsTitle =
			typeof tenantCol?.admin?.useAsTitle === 'string' ? tenantCol.admin.useAsTitle : 'id'
		// Every tenant, but only its title: the list feeds the filter and names the
		// tenant on each row, so a cap would drop both for the tenants past it.
		const tenantResult = await req.payload.find({
			collection: tenantsSlug,
			depth: 0,
			overrideAccess: true,
			pagination: false,
			select: useAsTitle === 'id' ? {} : { [useAsTitle]: true },
			sort: useAsTitle,
		})
		tenantOptions = tenantResult.docs.map((d) => ({
			label: String((d as unknown as Record<string, unknown>)[useAsTitle] ?? d.id),
			value: String(d.id),
		}))
	}

	const whereConditions = filterConditions(filters, { customFilters, lockedTenantId })
	if (forceWhere) whereConditions.push(forceWhere)

	const where: Where = whereConditions.length > 0 ? { and: whereConditions } : {}

	// Names for the documents and users the filters name, so their pills read as
	// names rather than ids. Bounded by what is selected, not by the log.
	const titleFieldOf = (slug: string): string => {
		const config = collectionConfigs.find((c) => c.slug === slug)
		return typeof config?.admin?.useAsTitle === 'string' ? config.admin.useAsTitle : 'id'
	}
	const authSlugs = Object.keys(userTitleFields)
	const refLabels = await resolveRefLabels(
		req,
		[
			...(filters.documents ?? []).map((ref) => ({ ref })),
			...(filters.users ?? []).map((ref) => ({
				fallbackSlug: authSlugs.length === 1 ? authSlugs[0] : undefined,
				ref,
			})),
			// Keyed `slug:id`, the way the filter's picker shows them.
			...customFilters.flatMap((f) =>
				(filters.custom?.[f.name] ?? []).map((id) => ({ ref: `${f.relationTo}:${id}` }))
			),
		],
		titleFieldOf
	)

	// `depth: 0`: the tenant column needs only its id, the name comes from the tenant
	// options already loaded for the filter, and the users are resolved just below.
	const result = await req.payload.find({
		collection: 'audit-logs',
		depth: 0,
		sort: '-createdAt',
		limit,
		page,
		where,
		overrideAccess: true,
	})
	const docs = await populateUsers(
		req,
		result.docs as unknown as Record<string, unknown>[],
		userTitleFields
	)

	// Rendered here rather than in the row: a renderer may be a server component, and
	// only this page can hand it `payload` and `req`.
	const customEvents = viewConfig?.components?.customEvents
	const renderedEvents: RenderedEvents = {}
	for (const doc of docs) {
		if (doc.operation !== 'custom') continue
		const eventType = typeof doc.eventType === 'string' ? doc.eventType : undefined
		const Component = resolveCustomEventComponent(customEvents, eventType)
		if (!Component || !eventType) continue
		const props: CustomEventComponentProps = {
			collection: String(doc.relationTo),
			createdAt: String(doc.createdAt),
			...(typeof doc.documentId === 'string' && { documentId: doc.documentId }),
			entry: doc,
			eventType,
			...(doc.metadata && typeof doc.metadata === 'object'
				? { metadata: doc.metadata as Record<string, unknown> }
				: {}),
		}
		const node = RenderServerComponent({
			clientProps: props,
			Component,
			importMap: req.payload.importMap,
			serverProps: { payload: req.payload, req },
		})
		if (node != null) renderedEvents[String(doc.id)] = node
	}

	const context = viewConfig?.loadContext
		? await viewConfig.loadContext({ entries: docs, req })
		: undefined
	// "Filter by this" for the slots: the current query plus one value, back on page one.
	const filterHref = (name: string, value: string): string => {
		const params = new URLSearchParams()
		for (const [key, raw] of Object.entries(sp)) {
			for (const v of Array.isArray(raw) ? raw : raw != null ? [raw] : []) params.append(key, v)
		}
		const key = `${CUSTOM_FILTER_PREFIX}${name}`
		if (!params.getAll(key).includes(value)) params.append(key, value)
		params.delete('page')
		return `?${params.toString()}`
	}
	const slotServerProps: AuditLogsSlotServerProps = { filterHref, payload: req.payload, req }
	const slots = viewConfig?.components
	const renderSlot = (
		Component: Parameters<typeof RenderServerComponent>[0]['Component'] | undefined,
		clientProps: AuditLogsListSlotProps | AuditLogsRowSlotProps
	) =>
		Component
			? RenderServerComponent({
					clientProps,
					Component,
					importMap: req.payload.importMap,
					serverProps: slotServerProps,
				})
			: undefined

	// Only the configured slots are rendered, and nothing at all when there are none, so
	// a view without slots pays for none of this.
	const renderedRows: Record<string, RenderedRowSlots> = {}
	if (slots?.user || slots?.rowBadges || slots?.beforeRowDetails || slots?.afterRowDetails) {
		for (const doc of docs) {
			const user = resolveUser(doc.user, userTitleFields)
			const impersonator = resolveUser(doc.impersonator, userTitleFields)
			const props: AuditLogsRowSlotProps = {
				context,
				entry: doc,
				...(impersonator && { impersonator }),
				...(user && { user }),
			}
			renderedRows[String(doc.id)] = {
				afterDetails: renderSlot(slots.afterRowDetails, props),
				badges: renderSlot(slots.rowBadges, props),
				beforeDetails: renderSlot(slots.beforeRowDetails, props),
				// A pill only exists for an entry with a user.
				user: user ? renderSlot(slots.user, props) : undefined,
			}
		}
	}
	const listProps: AuditLogsListSlotProps = { context, entries: docs }

	return (
		<DefaultTemplate
			i18n={req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={req.payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			user={user}
			visibleEntities={initPageResult.visibleEntities}
			req={req}
		>
			<Gutter>
				<AuditLogsClient
					adminRoute={req.payload.config.routes?.admin ?? '/admin'}
					apiRoute={req.payload.config.routes?.api ?? '/api'}
					collectionOptions={collectionOptions}
					docs={docs}
					filters={filters}
					globalOptions={globalOptions}
					tenantGlobalOptions={tenantGlobalOptions}
					collectionLabels={collectionLabels}
					tenantsSlug={multiTenancy ? tenantsSlug : undefined}
					globalLabels={globalLabels}
					refLabels={refLabels}
					titleFields={Object.fromEntries(
						collectionConfigs.map((c) => [c.slug, titleFieldOf(c.slug)])
					)}
					limit={limit}
					lockedTenantId={lockedTenantId}
					page={page}
					tenantOptions={tenantOptions}
					totalDocs={result.totalDocs}
					totalPages={result.totalPages}
					userTitleFields={userTitleFields}
					payloadAPILabels={payloadAPILabels(pluginOptions.logs?.payloadAPIs)}
					debugMode={pluginOptions.debug === true && Boolean(pluginOptions.retention)}
					hasArchive={Boolean(pluginOptions.retention?.archive)}
					renderedEvents={renderedEvents}
					renderedRows={renderedRows}
					beforeList={renderSlot(slots?.beforeList, listProps)}
					afterList={renderSlot(slots?.afterList, listProps)}
					customFilters={customFilters.map((f) => ({
						label: labelOf(f.label, req.i18n) ?? f.name,
						name: f.name,
						relationTo: f.relationTo,
					}))}
					customEventTypes={customEventTypeOptions(
						pluginOptions.logs?.eventTypes,
						viewConfig?.components?.customEvents
					)}
				/>
			</Gutter>
		</DefaultTemplate>
	)
}

/**
 * Titles for `slug:id` references, one query per collection. A bare id without a
 * known collection, or one that no longer resolves, keeps the id as its label.
 */
const resolveRefLabels = async (
	req: AdminViewServerProps['initPageResult']['req'],
	refs: { fallbackSlug?: string; ref: string }[],
	titleFieldOf: (slug: string) => string
): Promise<Record<string, string>> => {
	const labels: Record<string, string> = {}
	const bySlug = new Map<string, { id: string; ref: string }[]>()
	for (const { fallbackSlug, ref } of refs) {
		const { id, slug = fallbackSlug } = splitRef(ref)
		labels[ref] = id
		if (!slug) continue
		bySlug.set(slug, [...(bySlug.get(slug) ?? []), { id, ref }])
	}
	await Promise.all(
		[...bySlug].map(async ([slug, entries]) => {
			const titleField = titleFieldOf(slug)
			if (titleField === 'id') return
			try {
				const found = await req.payload.find({
					collection: slug as CollectionSlug,
					depth: 0,
					limit: entries.length,
					overrideAccess: true,
					pagination: false,
					select: { [titleField]: true },
					where: { id: { in: entries.map((e) => e.id) } },
				})
				for (const doc of found.docs as unknown as Record<string, unknown>[]) {
					const title = doc[titleField]
					for (const entry of entries) {
						if (String(doc.id) === entry.id && title) labels[entry.ref] = String(title)
					}
				}
			} catch {
				// An id of the wrong shape for this database; the id stays its own label.
			}
		})
	)
	return labels
}

const USER_REF_FIELDS = ['user', 'impersonator'] as const

/**
 * Puts each row's `user` and `impersonator` documents where a populated polymorphic
 * relationship would have them, one query per auth collection on the page. They are
 * stored as text, so Payload does not populate them. A user that no longer resolves
 * keeps its id as `value`, which the row shows as deleted.
 *
 * Reads only the title field: a whole user document carries the hashed password and
 * sessions, and the row renders one label.
 */
const populateUsers = async (
	req: AdminViewServerProps['initPageResult']['req'],
	docs: Record<string, unknown>[],
	userTitleFields: Record<string, string>
): Promise<Record<string, unknown>[]> => {
	const idsBySlug = new Map<string, Set<string>>()
	for (const doc of docs) {
		for (const name of USER_REF_FIELDS) {
			const ref = asUserRef(doc[name])
			if (!ref || !Object.hasOwn(userTitleFields, ref.relationTo)) continue
			idsBySlug.set(ref.relationTo, (idsBySlug.get(ref.relationTo) ?? new Set()).add(ref.value))
		}
	}

	const found = new Map<string, Record<string, unknown>>()
	await Promise.all(
		[...idsBySlug].map(async ([slug, ids]) => {
			const titleField = userTitleFields[slug] ?? 'id'
			try {
				const result = await req.payload.find({
					collection: slug as CollectionSlug,
					depth: 0,
					limit: ids.size,
					overrideAccess: true,
					pagination: false,
					select: titleField === 'id' ? {} : { [titleField]: true },
					where: { id: { in: [...ids] } },
				})
				for (const user of result.docs as unknown as Record<string, unknown>[]) {
					found.set(`${slug}:${String(user.id)}`, user)
				}
			} catch {
				// An id of the wrong shape for this database; those users show as deleted.
			}
		})
	)

	return docs.map((doc) => {
		const populated = { ...doc }
		for (const name of USER_REF_FIELDS) {
			const ref = asUserRef(doc[name])
			if (!ref) continue
			populated[name] = {
				relationTo: ref.relationTo,
				value: found.get(`${ref.relationTo}:${ref.value}`) ?? ref.value,
			}
		}
		return populated
	})
}

const asUserRef = (value: unknown): { relationTo: string; value: string } | undefined => {
	if (!value || typeof value !== 'object') return undefined
	const { relationTo, value: id } = value as Record<string, unknown>
	return typeof relationTo === 'string' && typeof id === 'string' && id.length > 0
		? { relationTo, value: id }
		: undefined
}
