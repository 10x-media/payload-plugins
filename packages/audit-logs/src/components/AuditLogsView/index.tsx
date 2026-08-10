import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, Where } from 'payload'
import { parseCookies } from 'payload'
import { keys } from '../../translations'
import { asTranslate } from '../../translations/server'
import type { AuditPluginConfig } from '../../types'
import { AuditLogsClient } from './AuditLogsClient.js'
import { GLOBAL_SENTINEL } from './utils.js'

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

	const notAllowed = (message: string) => (
		<DefaultTemplate
			i18n={req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={req.payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			visibleEntities={initPageResult.visibleEntities}
			req={req}
		>
			<Gutter>
				<p>{message}</p>
			</Gutter>
		</DefaultTemplate>
	)

	const t = asTranslate(req.i18n.t)

	if (!user) return notAllowed(t(keys.mustBeLoggedIn))

	if (useTenant) {
		const tenantViewConfig = multiTenancy?.tenantView
		const tenantViewAccess =
			tenantViewConfig != null && tenantViewConfig !== true && tenantViewConfig !== false
				? tenantViewConfig.access
				: undefined
		if (tenantViewAccess) {
			const allowed = await tenantViewAccess({ req })
			if (!allowed) return notAllowed(t(keys.noPermission))
		}
	} else if (viewAccess) {
		const allowed = await viewAccess({ req })
		if (!allowed) return notAllowed(t(keys.noPermission))
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

	const sp = ((await Promise.resolve(searchParams)) ?? {}) as Record<string, string | string[]>

	const getString = (v: string | string[] | undefined): string | undefined =>
		Array.isArray(v) ? v[0] : v

	const getArray = (v: string | string[] | undefined): string[] =>
		Array.isArray(v) ? v : v ? [v] : []

	const page = Number(getString(sp.page)) || 1
	const limit = Number(getString(sp.limit)) || configDefaultLimit
	const changedPaths = getArray(sp.changedPath)
	const collections = getArray(sp.collection)
	const globals = getArray(sp.global)
	const operations = getArray(sp.operation)
	const tenants = useTenant ? [] : getArray(sp.tenant)
	const userIds = getArray(sp.userId)
	const userCollection = getString(sp.userCollection)
	const dateFrom = getString(sp.dateFrom)
	const dateTo = getString(sp.dateTo)
	const group = getString(sp.group)

	// Collect collection and global slugs from config
	const collectionSlugs = req.payload.config.collections
		.map((c) => c.slug)
		.filter((slug) => slug !== 'audit-logs')
		.sort()

	const globalSlugs = (req.payload.config.globals ?? []).map((g) => g.slug).sort()

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
		const tenantsSlug = multiTenancy.tenantsSlug ?? 'tenants'
		const tenantCol = req.payload.config.collections.find((c) => c.slug === tenantsSlug)
		const useAsTitle =
			typeof tenantCol?.admin?.useAsTitle === 'string' ? tenantCol.admin.useAsTitle : 'id'
		const tenantResult = await req.payload.find({
			collection: tenantsSlug,
			limit: 500,
			depth: 0,
			overrideAccess: true,
		})
		tenantOptions = tenantResult.docs.map((d) => ({
			label: String((d as Record<string, unknown>)[useAsTitle] ?? d.id),
			value: String(d.id),
		}))
	}

	const whereConditions: Where[] = []

	// Collection / global filter — OR if both are active
	if (collections.length > 0 || globals.length > 0) {
		const parts: Where[] = []

		if (collections.length === 1) parts.push({ relationTo: { equals: collections[0] } })
		else if (collections.length > 1) parts.push({ relationTo: { in: collections } })

		if (globals.length === 1) {
			parts.push({
				and: [{ relationTo: { equals: GLOBAL_SENTINEL } }, { documentId: { equals: globals[0] } }],
			})
		} else if (globals.length > 1) {
			parts.push({
				and: [{ relationTo: { equals: GLOBAL_SENTINEL } }, { documentId: { in: globals } }],
			})
		}

		const [onlyPart] = parts
		whereConditions.push(parts.length === 1 && onlyPart ? onlyPart : { or: parts })
	}

	if (operations.length === 1) whereConditions.push({ operation: { equals: operations[0] } })
	else if (operations.length > 1) whereConditions.push({ operation: { in: operations } })

	// documentId filter only applies when no globals filter is active
	if (getString(sp.documentId) && !globals.length) {
		whereConditions.push({ documentId: { equals: getString(sp.documentId) } })
	}
	if (getString(sp.eventType))
		whereConditions.push({ eventType: { equals: getString(sp.eventType) } })
	for (const path of changedPaths) whereConditions.push({ changedPaths: { contains: path } })

	if (userIds.length) {
		const isPolymorphic = Object.keys(userTitleFields).length > 1
		if (isPolymorphic) {
			if (userIds.length === 1) whereConditions.push({ 'user.value': { equals: userIds[0] } })
			else whereConditions.push({ 'user.value': { in: userIds } })
			if (userCollection) whereConditions.push({ 'user.relationTo': { equals: userCollection } })
		} else {
			if (userIds.length === 1) whereConditions.push({ user: { equals: userIds[0] } })
			else whereConditions.push({ user: { in: userIds } })
		}
	}

	// Tenant filter — locked to cookie in tenant view, URL param in super-admin view
	if (lockedTenantId) {
		whereConditions.push({ tenant: { equals: lockedTenantId } })
	} else if (tenants.length === 1) {
		whereConditions.push({ tenant: { equals: tenants[0] } })
	} else if (tenants.length > 1) {
		whereConditions.push({ tenant: { in: tenants } })
	}

	if (group) whereConditions.push({ group: { equals: group } })
	if (dateFrom) whereConditions.push({ createdAt: { greater_than_equal: dateFrom } })
	if (dateTo) whereConditions.push({ createdAt: { less_than_equal: dateTo } })

	if (forceWhere) whereConditions.push(forceWhere)

	const where: Where = whereConditions.length > 0 ? { and: whereConditions } : {}

	const result = await req.payload.find({
		collection: 'audit-logs',
		depth: 1,
		sort: '-createdAt',
		limit,
		page,
		where,
		overrideAccess: true,
	})

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
					collectionSlugs={collectionSlugs}
					docs={result.docs as Record<string, unknown>[]}
					filters={{
						changedPaths: changedPaths.length ? changedPaths : undefined,
						collections: collections.length ? collections : undefined,
						dateFrom: dateFrom || undefined,
						dateTo: dateTo || undefined,
						documentId: globals.length ? undefined : getString(sp.documentId),
						eventType: getString(sp.eventType),
						globals: globals.length ? globals : undefined,
						group: group || undefined,
						operations: operations.length ? operations : undefined,
						tenants: tenants.length ? tenants : undefined,
						userCollection: userIds.length ? userCollection : undefined,
						userIds: userIds.length ? userIds : undefined,
					}}
					globalSlugs={globalSlugs}
					limit={limit}
					lockedTenantId={lockedTenantId}
					page={page}
					tenantOptions={tenantOptions}
					totalDocs={result.totalDocs}
					totalPages={result.totalPages}
					userTitleFields={userTitleFields}
					debugMode={pluginOptions.debug === true && Boolean(pluginOptions.retention)}
					hasArchive={Boolean(pluginOptions.retention?.archive)}
				/>
			</Gutter>
		</DefaultTemplate>
	)
}
