// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { impersonation } from '@10x-media/impersonation'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { buildConfig } from 'payload'
import { auditLogs } from '../src/index'
import { articles } from './collections/articles'
import { customers } from './collections/customers'
import { media } from './collections/media'
import { orderEvents, orders } from './collections/orders'
import { pages } from './collections/pages'
import { posts } from './collections/posts'
import { tags } from './collections/tags'
import { notes, tenantCollections, tenantSettings, tenants } from './collections/tenancy'
import { users } from './collections/users'
import { siteSettings } from './globals/siteSettings'
import { startMemoryMongo } from './helpers/memoryDb'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ??
						'postgres://e2e:e2e@localhost:35432/audit-logs_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url: process.env.DATABASE_URI_MONGO ?? (await startMemoryMongo()),
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	db,
	collections: [
		posts,
		pages,
		articles,
		orders,
		orderEvents,
		tags,
		media,
		users,
		customers,
		tenants,
		notes,
		tenantSettings,
	],
	globals: [siteSettings],
	plugins: [
		// Registered first, so its tenant field is on `notes` by the time the audit
		// hooks read it. The dev admin sees every tenant; the editor only Alpha.
		multiTenantPlugin({
			collections: tenantCollections,
			tenantsSlug: 'tenants',
			userHasAccessToAllTenants: (user) =>
				(user as { email?: string } | null)?.email === 'dev@10xmedia.de',
		}),
		auditLogs({
			// Every option below is set to a non-default value on purpose: the stand is
			// where the option surface gets exercised by hand, so defaults would hide
			// most of it. A real project usually needs far less.
			debug: true,
			// Mounts the second view at /admin/audit-logs-tenant, filtered by the tenant
			// picked in the nav. The same `collections` object as the multi-tenant plugin,
			// so `tenant-settings` shows there as a global.
			multiTenancy: { collections: tenantCollections },
			collections: {
				posts: {
					auditFields: true,
					auditLog: {
						excludeFields: ['internalNotes'],
						snapshotOnCreate: true,
						snapshotOnDelete: true,
					},
				},
				// Opted in for the log only: no createdBy / lastModifiedBy columns.
				tags: { auditLog: true },
				// Two collections with drafts and autosave, differing only in `drafts`.
				// Type into each, wait for the autosave, then compare the log.
				pages: { auditFields: true, auditLog: { drafts: 'ignore' } },
				articles: { auditFields: true, auditLog: { drafts: 'log' } },
				// Both audited, so one save on an order produces two entries: the order itself
				// and the event its afterChange hook writes.
				orders: { auditFields: true, auditLog: true },
				'order-events': { auditLog: true },
				// Auth events only. Document edits stay out, which is the common shape for
				// an auth collection: password hashes and login counters would flood the log.
				users: { auth: { login: true, forgotPassword: true, failedLogin: true } },
				customers: { auth: { login: true, failedLogin: true } },
				// Tenant-scoped: entries carry the note's tenant and show in the tenant view.
				notes: { auditFields: true, auditLog: true },
				'tenant-settings': { auditLog: true },
				tenants: { auditLog: true },
			},
			globals: {
				'site-settings': true,
			},
			anonymize: {
				posts: ({ path: fieldPath, redacted, value }) =>
					fieldPath === 'apiKey' ? redacted : value,
			},
			logs: {
				// Off by default. Visible here so the raw documents can be inspected
				// next to the custom view at /admin/audit-logs.
				hidden: false,
				group: true,
				view: {
					defaultLimit: 25,
					// The other seeded custom events keep the default table and JSON block.
					components: {
						customEvents: { order_refunded: '/components/RefundEvent#RefundEvent' },
					},
				},
			},
			retention: {
				// Cron strings are required by the type but nothing runs them: the stand
				// configures no job runner. `debug: true` puts Run buttons in the view,
				// which is how the two tasks are meant to be triggered here.
				deleteCron: '0 3 1 * *',
				queue: 'audit-retention',
				archive: {
					cron: '0 2 * * 0',
					uploadCollection: 'media',
				},
			},
		}),
		// Impersonate the seeded editor from the user menu, edit a post, and the entry's
		// user pill carries an impersonated mark naming the dev admin.
		// Customers cannot open the admin, so swapping into one would strand the session.
		impersonation({ access: { impersonate: () => true }, targets: ['users'] }),
	],
	// Two locales, so entries carry a locale badge and the localized fields in posts
	// diff per locale.
	localization: {
		defaultLocale: 'en',
		fallback: true,
		locales: [
			{ code: 'en', label: 'English' },
			{ code: 'de', label: 'Deutsch' },
		],
	},
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		user: 'users',
		components: {
			// The plugin's views are custom views, so the nav does not list them by itself.
			afterNavLinks: ['/components/AuditLogsNav#AuditLogsNav'],
		},
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
