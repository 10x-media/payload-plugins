// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { buildConfig, type CollectionConfig } from 'payload'
import { analytics, analyticsStat, analyticsStatRow, analyticsTab } from '../src/index'
import { native } from '../src/native/nativeAdapter'
import { seedDev } from './helpers/seed'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationDir = path.resolve(dirname, 'migrations')
const useDb = process.env.DEV_DB === 'postgres' ? 'postgres' : 'mongo'
const autoGenerate = process.env.PAYLOAD_SKIP_AUTOGEN !== '1'

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

const pages: CollectionConfig = {
	slug: 'pages',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'slug', type: 'text', required: true },
		analyticsStat({ metric: 'pageviews', position: 'sidebar' }),
		analyticsTab(),
		analyticsStatRow({ name: 'analytics_inline' }),
	],
}

const db =
	useDb === 'postgres'
		? postgresAdapter({
				migrationDir,
				pool: {
					connectionString:
						process.env.DATABASE_URI_POSTGRES ?? 'postgres://e2e:e2e@localhost:35432/analytics_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url:
					process.env.DATABASE_URI_MONGO ??
					'mongodb://localhost:37017/analytics_e2e?replicaSet=rs0&directConnection=true',
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	db,
	collections: [users, pages],
	plugins: [
		analytics({
			adapters: [native()],
			cache: { warm: true },
			sync: true,
			collections: { pages: { path: (doc) => (doc.slug ? `/${doc.slug as string}` : null) } },
			widgets: {
				register: [
					{
						slug: 'dev-custom-sources',
						component: '/components/DevCustomWidget#default',
						label: 'Custom: Top sources',
						requires: { dimensions: ['source'] },
					},
				],
			},
		}),
	],
	telemetry: false,
	onInit: async (payload) => {
		await seedDev(payload)
	},
	typescript: { autoGenerate },
	admin: {
		importMap: { autoGenerate, baseDir: path.resolve(dirname) },
		dashboard: {
			defaultLayout: [
				{
					widgetSlug: 'analytics-realtime',
					width: 'small',
					data: { metric: 'visitors', windowMinutes: 30 },
				},
				{
					widgetSlug: 'analytics-trend',
					width: 'large',
					data: { metric: 'pageviews', timeframe: 'last30days' },
				},
				{
					widgetSlug: 'analytics-trend',
					width: 'large',
					data: { metric: 'visitors', timeframe: 'last30days' },
				},
				{
					widgetSlug: 'analytics-metric',
					width: 'small',
					data: { metric: 'pageviews', timeframe: 'last30days' },
				},
				{
					widgetSlug: 'analytics-metric',
					width: 'small',
					data: { metric: 'visitors', timeframe: 'last30days' },
				},
				{
					widgetSlug: 'analytics-metric',
					width: 'small',
					data: { metric: 'sessions', timeframe: 'last30days' },
				},
				{
					widgetSlug: 'analytics-metric',
					width: 'small',
					data: { metric: 'avgDuration', timeframe: 'last30days' },
				},
				{
					widgetSlug: 'analytics-breakdown-pages',
					width: 'medium',
					data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
				},
				{
					widgetSlug: 'analytics-breakdown-sources',
					width: 'medium',
					data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
				},
				{
					widgetSlug: 'analytics-breakdown-devices',
					width: 'medium',
					data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
				},
				{
					widgetSlug: 'analytics-breakdown-countries',
					width: 'medium',
					data: { metric: 'pageviews', timeframe: 'last30days', limit: 5 },
				},
				{ widgetSlug: 'dev-custom-sources', width: 'medium', data: {} },
			],
		},
	},
})
