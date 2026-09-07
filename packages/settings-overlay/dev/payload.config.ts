// biome-ignore-all lint/plugin/noProcessEnv: dev app env boundary
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant'
import { ar } from '@payloadcms/translations/languages/ar'
import { en } from '@payloadcms/translations/languages/en'
import { buildConfig } from 'payload'

// Source imports, not the package name: the payload bin runs this file through tsx, which does
// not apply the `development` export condition, so the package name would resolve to `dist`.
// Dev components are bundled by Next and import the package name as a consumer would.
import { settingsOverlay } from '../src/index'
import { appearanceItem } from '../src/items/appearanceItem'
import { tenantGlobalItem } from '../src/items/tenantGlobalItem'

import {
	apiKeys,
	branding,
	posts,
	redirects,
	secrets,
	siteSettings,
	tags,
	tenants,
	users,
} from './collections'
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
						'postgres://e2e:e2e@localhost:35432/settings-overlay_e2e',
				},
			})
		: mongooseAdapter({
				ensureIndexes: true,
				migrationDir,
				url: process.env.DATABASE_URI_MONGO ?? (await startMemoryMongo()),
			})

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? 'dev-secret-not-for-prod',
	admin: {
		components: {
			beforeNavLinks: ['./components/OverlayLaunchers#OverlayLaunchers'],
			views: {
				devReport: {
					Component: './components/DevReportView#DevReportView',
					exact: true,
					path: '/dev-report',
				},
			},
		},
		importMap: {
			autoGenerate,
			baseDir: path.resolve(dirname),
		},
		user: users.slug,
	},
	collections: [users, tenants, tags, redirects, posts, secrets, siteSettings, apiKeys],
	db,
	// Arabic is here to exercise RTL: Payload flips `dir` on the document from the language, so
	// switching to it in the panel's Appearance row is the whole test.
	i18n: { supportedLanguages: { ar, en } },
	globals: [branding],
	onInit: async (payload) => {
		await seedDev(payload)
	},
	plugins: [
		multiTenantPlugin({
			collections: {
				'site-settings': { isGlobal: true },
			},
			tenantsSlug: tenants.slug,
			userHasAccessToAllTenants: () => true,
		}),
		// After multi-tenant, which rewrites `site-settings`, and after anything registering an
		// admin view: `view` items are validated against `admin.components.views` at boot.
		settingsOverlay({
			defaults: { layout: 'compact' },
			overlays: [
				{
					icon: './components/icons#GearIcon',
					id: 'system',
					items: [
						appearanceItem(),
						{
							component: './components/DevNotes#DevNotes',
							label: 'Notes',
							slug: 'notes',
							type: 'component',
						},
						{
							component: './components/DevStats#DevStats',
							label: 'Stats',
							lazy: true,
							slug: 'stats',
							type: 'component',
						},
						{ badge: { type: 'collection-count' }, slug: 'tags', type: 'collection' },
						{ slug: 'redirects', type: 'collection' },
						{ slug: 'branding', type: 'global' },
						tenantGlobalItem({ group: 'Content', label: 'Site settings', slug: 'site-settings' }),
						{ label: 'Dev report', slug: 'report', type: 'view', viewKey: 'devReport' },
						{ href: '/account', label: 'Account', order: 100, slug: 'account', type: 'link' },
					],
					label: 'System',
				},
				{
					id: 'workspace',
					// Grouped and searchable, to exercise the two together. Deliberate overlaps:
					// "overview" matches one row in each of two groups, "keyboard" matches a label
					// that does not contain it, and "zzz" matches nothing at all.
					items: [
						// Ungrouped, so it renders first and is never collapsible.
						appearanceItem({ slug: 'look' }),
						{
							component: './components/DevNotes#DevNotes',
							keywords: ['scratch', 'memo'],
							label: 'Notes',
							slug: 'notes',
							type: 'component',
						},

						{
							group: 'Workspace',
							href: '/',
							keywords: ['overview', 'home'],
							label: 'Dashboard',
							slug: 'dashboard',
							type: 'link',
						},
						{
							component: './components/DevStats#DevStats',
							group: 'Workspace',
							keywords: ['usage', 'metrics'],
							label: 'Stats',
							lazy: true,
							slug: 'stats',
							type: 'component',
						},

						{ group: 'Data', slug: 'secrets', type: 'collection' },
						{
							group: 'Data',
							href: '/',
							keywords: ['download', 'csv', 'backup'],
							label: 'Exports',
							slug: 'exports',
							type: 'link',
						},

						{
							group: 'Help',
							href: '/',
							keywords: ['overview', 'guide'],
							label: 'Documentation',
							slug: 'docs',
							type: 'link',
						},
						{
							group: 'Help',
							href: '/',
							keywords: ['keyboard', 'hotkeys'],
							label: 'Shortcuts',
							slug: 'shortcuts',
							type: 'link',
						},
					],
					label: 'Workspace',
					layout: 'wide',
					// The escape hatch: this panel keeps Payload's own list header, so the two overlays
					// show both behaviours side by side.
					mergeListHeader: false,
					searchable: true,
				},
				{
					// Every composable slot replaced at once, which is the point: this panel shares no
					// markup with the two above except the frame the plugin draws around it. `Panel`
					// and `Rail` are deliberately left alone, because either one swallows the slots
					// below it.
					components: {
						Empty: './components/studio/StudioEmpty#StudioEmpty',
						Header: './components/studio/StudioHeader#StudioHeader',
						RailGroup: './components/studio/StudioRailGroup#StudioRailGroup',
						RailItem: './components/studio/StudioRailItem#StudioRailItem',
						Search: './components/studio/StudioSearch#StudioSearch',
					},
					id: 'studio',
					items: [
						{
							component: './components/DevNotes#DevNotes',
							label: 'Profile',
							slug: 'profile',
							type: 'component',
						},
						{ href: '/', label: 'Brand', slug: 'brand', type: 'link' },

						{ group: 'Team', href: '/', label: 'Members', slug: 'members', type: 'link' },
						{
							group: 'Team',
							href: '/',
							keywords: ['segments', 'cohorts'],
							label: 'Audience',
							slug: 'audience',
							type: 'link',
						},

						{ group: 'Delivery', href: '/', label: 'Domains', slug: 'domains', type: 'link' },
						{
							group: 'Delivery',
							href: '/',
							keywords: ['events', 'callbacks'],
							label: 'Webhooks',
							slug: 'webhooks',
							type: 'link',
						},

						// The one real collection here, so the replaced header has a list to walk into
						// and a back button to draw.
						{
							badge: { type: 'collection-count' },
							group: 'Account',
							slug: 'keys',
							type: 'collection',
						},
						{ group: 'Account', href: '/', label: 'Billing', slug: 'billing', type: 'link' },
						{ group: 'Account', href: '/', label: 'Plan', slug: 'plan', type: 'link' },
					],
					label: 'Studio',
					layout: 'wide',
					searchable: true,
				},
			],
		}),
	],
	telemetry: false,
	typescript: { autoGenerate },
})
