// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig } from 'payload'
import { auditLogs } from '../src/index'
import { articles } from './collections/articles'
import { media } from './collections/media'
import { orderEvents, orders } from './collections/orders'
import { pages } from './collections/pages'
import { posts } from './collections/posts'
import { tags } from './collections/tags'
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
	collections: [posts, pages, articles, orders, orderEvents, tags, media, users],
	globals: [siteSettings],
	plugins: [
		auditLogs({
			// Every option below is set to a non-default value on purpose: the stand is
			// where the option surface gets exercised by hand, so defaults would hide
			// most of it. A real project usually needs far less.
			debug: true,
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
				users: { auth: true },
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
				view: { defaultLimit: 25 },
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
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
	},
})
