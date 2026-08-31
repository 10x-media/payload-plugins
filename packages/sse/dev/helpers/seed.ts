import type { Payload } from 'payload'

export const PLATFORM_ADMIN_EMAIL = 'dev@10xmedia.de'

const VIEWER_EMAIL = 'viewer@10xmedia.de'
const GLOBEX_EMAIL = 'globex@10xmedia.de'
const PASSWORD = 'password'

const TENANTS = ['Acme', 'Globex'] as const

type SeedUser = {
	email: string
	name: string
	tenantNames: readonly string[]
}

const USERS: SeedUser[] = [
	{ email: PLATFORM_ADMIN_EMAIL, name: 'Admin', tenantNames: TENANTS },
	{ email: VIEWER_EMAIL, name: 'Viewer', tenantNames: ['Acme'] },
	{ email: GLOBEX_EMAIL, name: 'Globex editor', tenantNames: ['Globex'] },
]

const PAGES: { title: string; status: 'draft' | 'live' | 'archived'; tenantName: string }[] = [
	{ title: 'Hello Acme', status: 'live', tenantName: 'Acme' },
	{ title: 'Acme draft', status: 'draft', tenantName: 'Acme' },
	{ title: 'Hello Globex', status: 'live', tenantName: 'Globex' },
	{ title: 'Globex archived', status: 'archived', tenantName: 'Globex' },
]

const upsertTenant = async (payload: Payload, name: string): Promise<string> => {
	const existing = await payload.find({
		collection: 'tenants',
		where: { name: { equals: name } },
		limit: 1,
		overrideAccess: true,
	})
	const doc = existing.docs[0]
	if (doc) return String(doc.id)
	const created = await payload.create({
		collection: 'tenants',
		data: { name },
		overrideAccess: true,
	})
	payload.logger.info(`Seeded tenant: ${name}`)
	return String(created.id)
}

const upsertUser = async (
	payload: Payload,
	user: SeedUser,
	tenantIdsByName: Record<string, string>
): Promise<void> => {
	const existing = await payload.find({
		collection: 'users',
		where: { email: { equals: user.email } },
		limit: 1,
		overrideAccess: true,
	})
	const tenants = user.tenantNames.map((name) => {
		const tenant = tenantIdsByName[name]
		if (!tenant) throw new Error(`missing tenant ${name}`)
		return { tenant }
	})
	const found = existing.docs[0]
	if (found) {
		await payload.update({
			collection: 'users',
			id: found.id,
			data: { name: user.name, tenants } as never,
			overrideAccess: true,
		})
		return
	}
	await payload.create({
		collection: 'users',
		data: { email: user.email, password: PASSWORD, name: user.name, tenants } as never,
		overrideAccess: true,
	})
	payload.logger.info(`Seeded dev user: ${user.email} / ${PASSWORD}`)
}

const upsertPage = async (
	payload: Payload,
	page: (typeof PAGES)[number],
	tenantIdsByName: Record<string, string>
): Promise<void> => {
	const tenant = tenantIdsByName[page.tenantName]
	if (!tenant) throw new Error(`missing tenant ${page.tenantName}`)
	const existing = await payload.find({
		collection: 'pages',
		where: { title: { equals: page.title } },
		limit: 1,
		overrideAccess: true,
	})
	if (existing.docs[0]) return
	await payload.create({
		collection: 'pages',
		data: { title: page.title, status: page.status, tenant } as never,
		overrideAccess: true,
	})
	payload.logger.info(`Seeded page: ${page.title}`)
}

/**
 * Idempotent playground fixtures: tenants, three logins, sample pages.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const tenantIdsByName: Record<string, string> = {}
	for (const name of TENANTS) {
		tenantIdsByName[name] = await upsertTenant(payload, name)
	}
	for (const user of USERS) {
		await upsertUser(payload, user, tenantIdsByName)
	}
	for (const page of PAGES) {
		await upsertPage(payload, page, tenantIdsByName)
	}
}
