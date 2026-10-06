import { type BootedPayload, bootPayload, type SupportedDb } from '@10x-media/payload-test-harness'
import {
	type CollectionConfig,
	type CollectionSlug,
	type Config,
	createLocalReq,
	type PayloadRequest,
} from 'payload'

import {
	articles,
	companies,
	customers,
	leads,
	memberships,
	notes,
	orders,
	trips,
} from '../../dev/collections'
import { KEYS_SLUG, PAIRS_SLUG } from '../../src/collections/slugs'
import { dedupe } from '../../src/index'
import type { DedupePluginOptions } from '../../src/options'
import type { DedupeEvent } from '../../src/plugin/events'
import type { PairRow } from '../../src/queue/pairs'

export const CUSTOMERS = 'customers' as CollectionSlug
export const COMPANIES = 'companies' as CollectionSlug
export const LEADS = 'leads' as CollectionSlug
export const ARTICLES = 'articles' as CollectionSlug
export const ACCOUNTS = 'accounts' as CollectionSlug
export const TICKETS = 'tickets' as CollectionSlug
export const STAFF = 'staff' as CollectionSlug
export const LOGS = 'logs' as CollectionSlug
export const VAULTS = 'vaults' as CollectionSlug
export const AGENTS = 'agents' as CollectionSlug
export const FRAGILE = 'fragile' as CollectionSlug
export const TEAMS = 'teams' as CollectionSlug
export const POSTS = 'posts' as CollectionSlug
export const KITS = 'kits' as CollectionSlug
export const HIDX = 'hidx' as CollectionSlug
export const GUIDES = 'guides' as CollectionSlug
export const MANUALS = 'manuals' as CollectionSlug
export const PAGES = 'pages' as CollectionSlug

export type Doc = Record<string, unknown> & { id: number | string }

/** Every event the plugin emitted during the run, for the tests to inspect. */
export const emitted: DedupeEvent[] = []

export const pluginOptions: DedupePluginOptions = {
	collections: {
		customers: {
			match: {
				fields: [
					{ path: 'email', weight: 45 },
					{ path: 'name', weight: 40, compare: 'text' },
					{ path: 'phone', weight: 35, compare: 'phone' },
					{ path: 'birthDate', weight: 25, compare: 'date', onDiffer: -25 },
				],
			},
			fields: (derived) =>
				derived.map((spec) =>
					spec.path === 'profile.score' ? { ...spec, policy: 'manual' } : spec
				),
		},
		leads: { absorbed: 'delete' },
		articles: {},
		accounts: {},
		tickets: { absorbed: 'delete' },
		staff: {},
		hidx: {},
		manuals: {
			fields: (derived) =>
				derived.map((spec) =>
					spec.path === 'title'
						? { ...spec, policy: 'survivor' }
						: spec.path === 'code'
							? { ...spec, policy: 'skip' }
							: spec
				),
		},
		guides: {
			fields: (derived) =>
				derived.map((spec) => (spec.path === 'title' ? { ...spec, policy: 'survivor' } : spec)),
		},
		kits: {
			fields: (derived) =>
				derived.map((spec) => (spec.path === 'secret' ? { ...spec, policy: 'manual' } : spec)),
		},
		vaults: { absorbed: 'delete' },
		agents: { absorbed: 'delete' },
		fragile: {},
		teams: {},
		posts: { match: { fields: [{ path: 'title', weight: 1 }] } },
		pages: {},
	},
	multiTenancy: true,
	disableJobsQueue: true,
	events: { emit: (event) => void emitted.push(event) },
}

export const plugin = dedupe(pluginOptions)

/** Every kind of unique value a merge can move to the survivor. */
const accountsFor = (db: SupportedDb): CollectionConfig => ({
	slug: 'accounts',
	trash: true,
	indexes: [
		{ fields: ['region', 'externalId'], unique: true },
		{ fields: ['region', 'desk'], unique: true },
		{ fields: ['title', 'subtitle'], unique: true },
		// SQL refuses an index that mixes localized and plain fields.
		...(db === 'mongo' ? [{ fields: ['region', 'label'], unique: true }] : []),
	],
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'email', type: 'email', unique: true },
		// SQL refuses a unique `hasMany` text.
		...(db === 'mongo'
			? [{ name: 'aliases', type: 'text' as const, hasMany: true, unique: true }]
			: []),
		{ name: 'handle', type: 'text', unique: true, required: true },
		{ name: 'slug', type: 'text', unique: true, localized: true },
		{ name: 'code', type: 'text', unique: true, maxLength: 6 },
		{ name: 'seat', type: 'number', unique: true },
		{ name: 'pin', type: 'number', unique: true, required: true },
		{ name: 'badge', type: 'relationship', relationTo: 'companies', unique: true },
		{ name: 'region', type: 'select', options: ['eu', 'us'] },
		{ name: 'externalId', type: 'text' },
		{ name: 'desk', type: 'number' },
		{ name: 'title', type: 'text', localized: true },
		{ name: 'subtitle', type: 'text', localized: true },
		{ name: 'label', type: 'text', localized: true },
		{ name: 'phones', type: 'array', fields: [{ name: 'number', type: 'text', unique: true }] },
		{
			name: 'contact',
			type: 'group',
			fields: [
				{ name: 'email', type: 'email', unique: true },
				{ name: 'phone', type: 'text' },
			],
		},
		{
			name: 'links',
			type: 'blocks',
			blocks: [{ slug: 'site', fields: [{ name: 'href', type: 'text', unique: true }] }],
		},
	],
})

/** No trash: the absorbed document is deleted. */
const tickets: CollectionConfig = {
	slug: 'tickets',
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'seat', type: 'number', unique: true },
		// Hidden from the API, so only the record's copy keeps it once a ticket is merged away.
		{ name: 'externalRef', type: 'text', hidden: true },
		{ name: 'vendor', type: 'group', hidden: true, fields: [{ name: 'code', type: 'text' }] },
		{
			name: 'stubs',
			type: 'array',
			fields: [
				{ name: 'code', type: 'text' },
				{ name: 'barcode', type: 'text', hidden: true, unique: true },
				{ name: 'extra', type: 'group', fields: [{ name: 'serial', type: 'text', hidden: true }] },
			],
		},
	],
}

const emailOf = (req: PayloadRequest): string =>
	String((req.user as { email?: string } | null)?.email ?? '')

/**
 * Field access: readers whose email starts with `limited` may not see `salary` or a bonus's
 * `amount`, nor change `grade` or who approved a bonus. A private bonus hides its `note`
 * and a locked one keeps its `reviewer`, from everyone, by the row's own flags. An audit's
 * `secret` is read by no one and its `frozen` changed by no one.
 */
const staff: CollectionConfig = {
	slug: 'staff',
	trash: true,
	// Anyone may move a document to the trash; only those not `limited` may delete one for good.
	access: {
		delete: ({ req, data }) =>
			Boolean((data as { deletedAt?: unknown } | undefined)?.deletedAt) ||
			!emailOf(req).startsWith('limited'),
		// A keeper changes only staff of grade `mine`; moving one to the trash is a change too.
		update: ({ req }) => (emailOf(req).startsWith('keeper') ? { grade: { equals: 'mine' } } : true),
	},
	fields: [
		{ name: 'name', type: 'text' },
		{
			name: 'salary',
			type: 'number',
			access: { read: ({ req }) => !emailOf(req).startsWith('limited') },
		},
		{
			name: 'grade',
			type: 'text',
			access: { update: ({ req }) => !emailOf(req).startsWith('limited') },
		},
		// Read only where the document is not sealed.
		{ name: 'sealed', type: 'checkbox' },
		{
			name: 'homePhone',
			type: 'text',
			access: { read: ({ doc }) => !(doc as { sealed?: boolean } | undefined)?.sealed },
		},
		{
			name: 'buddy',
			type: 'relationship',
			relationTo: 'staff',
			access: { read: ({ doc }) => !(doc as { sealed?: boolean } | undefined)?.sealed },
		},
		{
			name: 'bonuses',
			type: 'array',
			fields: [
				{ name: 'label', type: 'text' },
				{
					name: 'amount',
					type: 'number',
					access: { read: ({ req }) => !emailOf(req).startsWith('limited') },
				},
				{
					name: 'approvedBy',
					type: 'text',
					access: { update: ({ req }) => !emailOf(req).startsWith('limited') },
				},
				{ name: 'private', type: 'checkbox' },
				{
					name: 'sealedNote',
					type: 'text',
					access: { read: ({ doc }) => !(doc as { sealed?: boolean } | undefined)?.sealed },
				},
				{
					name: 'sealedRich',
					type: 'richText',
					access: { read: ({ doc }) => !(doc as { sealed?: boolean } | undefined)?.sealed },
				},
				{
					name: 'sealedGroup',
					type: 'group',
					access: { read: ({ doc }) => !(doc as { sealed?: boolean } | undefined)?.sealed },
					fields: [{ name: 'inner', type: 'text' }],
				},
				{
					name: 'note',
					type: 'text',
					access: { read: ({ siblingData }) => !(siblingData as { private?: boolean })?.private },
				},
				{ name: 'locked', type: 'checkbox' },
				{
					name: 'reviewer',
					type: 'text',
					access: { update: ({ siblingData }) => !(siblingData as { locked?: boolean })?.locked },
				},
				// Values per locale inside a row that is not localized itself.
				{ name: 'tagline', type: 'text', localized: true },
				{
					name: 'memos',
					type: 'array',
					localized: true,
					fields: [
						{ name: 'text', type: 'text' },
						{ name: 'code', type: 'text', unique: true },
					],
				},
				{
					name: 'audits',
					type: 'array',
					localized: true,
					fields: [
						{ name: 'secret', type: 'text', access: { read: () => false } },
						{ name: 'frozen', type: 'text', access: { update: () => false } },
					],
				},
			],
		},
	],
}

/** Named by a field readers whose email starts with `limited` may not read. */
const agents: CollectionConfig = {
	slug: 'agents',
	admin: { useAsTitle: 'codename' },
	fields: [
		{
			name: 'codename',
			type: 'text',
			access: { read: ({ req }) => !emailOf(req).startsWith('limited') },
		},
		{ name: 'desk', type: 'text' },
	],
}

/** Row access: a reader whose email starts with `owner` reads only the rows they own. */
const vaults: CollectionConfig = {
	slug: 'vaults',
	trash: true,
	admin: { useAsTitle: 'name' },
	access: {
		read: ({ req }) =>
			emailOf(req).startsWith('owner') ? { owner: { equals: emailOf(req) } } : true,
	},
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'owner', type: 'text' },
		{ name: 'secret', type: 'text' },
		{ name: 'memo', type: 'richText' },
	],
}

/**
 * References through blocks in every shape a query by path gets wrong: fields of one name in
 * several blocks (`note.person` is text and comes first), blocks in blocks, in rows and in a
 * localized group, a polymorphic one, a block whose `items` lack the field, a localized tab.
 */
const layouts: CollectionConfig = {
	slug: 'layouts',
	fields: [
		{ name: 'title', type: 'text' },
		// Hidden from the API: a read without `showHiddenFields` returns none of it.
		{ name: 'sponsor', type: 'relationship', relationTo: 'customers', hidden: true },
		{
			name: 'layout',
			type: 'blocks',
			blocks: [
				{ slug: 'note', fields: [{ name: 'person', type: 'text' }] },
				{
					slug: 'quote',
					fields: [{ name: 'person', type: 'relationship', relationTo: 'customers' }],
				},
				{
					slug: 'shout',
					fields: [{ name: 'person', type: 'relationship', relationTo: 'customers' }],
				},
				{
					slug: 'crowd',
					fields: [
						{ name: 'person', type: 'relationship', relationTo: 'customers', hasMany: true },
					],
				},
				{
					slug: 'nest',
					fields: [
						{
							name: 'inner',
							type: 'blocks',
							blocks: [
								{
									slug: 'deep',
									fields: [{ name: 'guest', type: 'relationship', relationTo: 'customers' }],
								},
							],
						},
					],
				},
				{
					slug: 'poly',
					fields: [{ name: 'who', type: 'relationship', relationTo: ['customers', 'companies'] }],
				},
				// Payload follows `items` into the first block that has it, which has no `person`.
				{
					slug: 'gallery',
					fields: [{ name: 'items', type: 'array', fields: [{ name: 'caption', type: 'text' }] }],
				},
				{
					slug: 'team',
					fields: [
						{
							name: 'items',
							type: 'array',
							fields: [{ name: 'person', type: 'relationship', relationTo: 'customers' }],
						},
					],
				},
				// A list of pointers in a block that is not the first, as is and in rows.
				{
					slug: 'cast',
					fields: [
						{ name: 'members', type: 'relationship', relationTo: 'customers', hasMany: true },
					],
				},
				{
					slug: 'roll',
					fields: [
						{
							name: 'lines',
							type: 'array',
							fields: [
								{ name: 'member', type: 'relationship', relationTo: 'customers', hasMany: true },
							],
						},
					],
				},
			],
		},
		{
			name: 'featured',
			type: 'relationship',
			relationTo: ['customers', 'companies'],
			localized: true,
		},
		{
			name: 'fans',
			type: 'relationship',
			relationTo: ['customers', 'companies'],
			hasMany: true,
			localized: true,
		},
		{
			name: 'spots',
			type: 'array',
			localized: true,
			fields: [{ name: 'spot', type: 'relationship', relationTo: ['customers', 'companies'] }],
		},
		{
			name: 'credits',
			type: 'array',
			fields: [
				{
					name: 'credit',
					type: 'relationship',
					relationTo: ['customers', 'companies'],
					localized: true,
				},
			],
		},
		{
			name: 'info',
			type: 'group',
			localized: true,
			fields: [
				{ name: 'source', type: 'relationship', relationTo: ['customers', 'companies'] },
				{
					name: 'lines',
					type: 'array',
					fields: [{ name: 'who', type: 'relationship', relationTo: 'customers' }],
				},
			],
		},
		{
			type: 'tabs',
			tabs: [
				{
					name: 'meta',
					localized: true,
					fields: [{ name: 'owner', type: 'relationship', relationTo: 'customers' }],
				},
			],
		},
		// Shapes the SQL adapter cannot query by path: blocks in rows and in a localized group.
		{
			name: 'sections',
			type: 'array',
			fields: [
				{
					name: 'content',
					type: 'blocks',
					blocks: [
						{
							slug: 'pick',
							fields: [{ name: 'host', type: 'relationship', relationTo: 'customers' }],
						},
						{
							slug: 'hosts',
							fields: [
								{ name: 'host', type: 'relationship', relationTo: 'customers', hasMany: true },
							],
						},
					],
				},
			],
		},
		{
			name: 'local',
			type: 'group',
			localized: true,
			fields: [
				{
					name: 'parts',
					type: 'blocks',
					blocks: [
						{
							slug: 'mention',
							fields: [{ name: 'named', type: 'relationship', relationTo: 'customers' }],
						},
					],
				},
			],
		},
	],
}

/**
 * References to customers in values per locale: plain ones in rows beside a localized memo, and
 * ones inside a localized list and a localized group.
 */
const logs: CollectionConfig = {
	slug: 'logs',
	fields: [
		{ name: 'title', type: 'text' },
		{
			name: 'entries',
			type: 'array',
			fields: [
				{ name: 'by', type: 'relationship', relationTo: 'customers' },
				{ name: 'memo', type: 'text', localized: true },
			],
		},
		{
			name: 'crew',
			type: 'array',
			localized: true,
			fields: [{ name: 'member', type: 'relationship', relationTo: 'customers' }],
		},
		{
			name: 'desk',
			type: 'group',
			localized: true,
			fields: [{ name: 'lead', type: 'relationship', relationTo: 'customers' }],
		},
	],
}

/**
 * An update that changes the title to `boom` fails, for a merge that breaks halfway: the
 * survivor taking that title from an absorbed document. `seat` is unique and required, so an
 * absorbed document whose seat the survivor takes leaves before the survivor is written.
 */
const fragile: CollectionConfig = {
	slug: 'fragile',
	trash: true,
	hooks: {
		beforeChange: [
			({ data, operation, originalDoc }) => {
				const title = (data as { title?: unknown }).title
				if (operation === 'update' && title === 'boom' && originalDoc?.title !== 'boom') {
					throw new Error('boom')
				}
				return data
			},
		],
	},
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'seat', type: 'number', unique: true, required: true },
	],
}

/** Rows inside rows: on Postgres every row, nested ones too, is keyed by its own id. */
const teams: CollectionConfig = {
	slug: 'teams',
	trash: true,
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'parent', type: 'relationship', relationTo: 'teams', admin: { hidden: true } },
		{
			name: 'members',
			type: 'array',
			fields: [
				{ name: 'person', type: 'text' },
				{ name: 'phones', type: 'array', fields: [{ name: 'number', type: 'text' }] },
				{ name: 'mentor', type: 'relationship', relationTo: 'teams' },
				{ name: 'backup', type: 'relationship', relationTo: 'teams', localized: true },
			],
		},
		// A block the config names once for every collection, holding rows of its own.
		{ name: 'boards', type: 'blocks', blocks: [], blockReferences: ['roster'] },
		// A localized group is one value per locale, rows and all.
		{
			name: 'card',
			type: 'group',
			localized: true,
			fields: [
				{ name: 'title', type: 'text' },
				{ name: 'rival', type: 'relationship', relationTo: 'teams' },
				{
					name: 'lines',
					type: 'array',
					fields: [
						{ name: 'text', type: 'text' },
						{ name: 'badge', type: 'text', unique: true },
					],
				},
			],
		},
	],
}

/**
 * Drafts and a match config: the live check has to leave out what is not published. A save
 * starts from the newest version, which a unique value given up has to reach too.
 */
const posts: CollectionConfig = {
	slug: 'posts',
	trash: true,
	versions: { drafts: true },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'code', type: 'text', unique: true },
		{ name: 'slug', type: 'text', unique: true, localized: true },
	],
}

/** A rich text field, for the merge screen to draw as the version view does. */
const pages: CollectionConfig = {
	slug: 'pages',
	trash: true,
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'body', type: 'richText' },
	],
}

/**
 * A required column beside a group holding unique values, one of them localized, a unique
 * index over a field hidden from the API, and fields `limited` readers may not read.
 */
const kits: CollectionConfig = {
	slug: 'kits',
	trash: true,
	indexes: [{ fields: ['region', 'ref'], unique: true }],
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'title', type: 'text', required: true },
		{ name: 'sealed', type: 'checkbox' },
		{ name: 'region', type: 'select', options: ['eu', 'us'] },
		{ name: 'ref', type: 'text', hidden: true },
		{
			name: 'secret',
			type: 'number',
			access: {
				read: ({ req }) => !emailOf(req).startsWith('limited'),
				update: ({ req }) => !emailOf(req).startsWith('limited-fixed'),
			},
		},
		{
			name: 'contact',
			type: 'group',
			fields: [
				{ name: 'email', type: 'email', unique: true },
				{ name: 'slug', type: 'text', unique: true, localized: true },
				{ name: 'phone', type: 'text' },
			],
		},
		{
			name: 'crew',
			type: 'array',
			access: { read: ({ doc }) => !(doc as { sealed?: boolean } | undefined)?.sealed },
			fields: [
				{ name: 'label', type: 'text' },
				{ name: 'pal', type: 'relationship', relationTo: 'kits', access: { update: () => false } },
			],
		},
	],
}

/** A title required in every language, and steps whose text is per language. */
const guides: CollectionConfig = {
	slug: 'guides',
	trash: true,
	fields: [
		{ name: 'title', type: 'text', localized: true, required: true },
		{ name: 'steps', type: 'array', fields: [{ name: 'text', type: 'text', localized: true }] },
	],
}

/**
 * Values Payload requires in each language it writes: a title kept from the primary, a code
 * the merge skips, a motto a sealed document hides, and an answer in each step.
 */
const manuals: CollectionConfig = {
	slug: 'manuals',
	trash: true,
	fields: [
		{ name: 'title', type: 'text', localized: true, required: true },
		{ name: 'subtitle', type: 'text', localized: true },
		{ name: 'code', type: 'text', localized: true, required: true },
		{ name: 'sealed', type: 'checkbox' },
		{
			name: 'motto',
			type: 'text',
			localized: true,
			required: true,
			access: { read: ({ doc }) => !(doc as { sealed?: boolean } | undefined)?.sealed },
		},
		{
			name: 'steps',
			type: 'array',
			fields: [{ name: 'text', type: 'text', localized: true, required: true }],
		},
	],
}

/** A unique index over a field of a group hidden from the API. */
const hidx: CollectionConfig = {
	slug: 'hidx',
	trash: true,
	indexes: [{ fields: ['region', 'vendor.code'], unique: true }],
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'region', type: 'select', options: ['eu', 'us'] },
		{ name: 'vendor', type: 'group', hidden: true, fields: [{ name: 'code', type: 'text' }] },
	],
}

/**
 * Payload adds its own `users` auth collection when the config has none. The dev app gets
 * its `tenant` relationship from the multi-tenant plugin; these tests run without it, so a
 * plain text field stands in, which is all the plugin reads.
 */
export const collectionsFor = (db: SupportedDb) => [
	{ ...customers, fields: [...customers.fields, { name: 'tenant', type: 'text' as const }] },
	companies,
	leads,
	articles,
	orders,
	memberships,
	trips,
	notes,
	accountsFor(db),
	tickets,
	staff,
	vaults,
	agents,
	fragile,
	teams,
	posts,
	pages,
	logs,
	layouts,
	kits,
	hidx,
	guides,
	manuals,
]

/** A new object on every boot: Payload sanitizes the config's blocks in place. */
export const configOverrides = (): Partial<Config> => ({
	localization: { locales: ['en', 'de'], defaultLocale: 'en' },
	blocks: [
		{
			slug: 'roster',
			fields: [{ name: 'seats', type: 'array', fields: [{ name: 'label', type: 'text' }] }],
		},
	],
	globals: [
		{
			slug: 'settings',
			fields: [
				{ name: 'featured', type: 'relationship', relationTo: 'customers' },
				{ name: 'spotlight', type: 'relationship', relationTo: 'customers', localized: true },
				{
					name: 'picks',
					type: 'array',
					fields: [
						{ name: 'customer', type: 'relationship', relationTo: 'customers' },
						{ name: 'backup', type: 'relationship', relationTo: 'customers', localized: true },
						{ name: 'note', type: 'text', localized: true },
					],
				},
			],
		},
		{
			slug: 'promo',
			versions: { drafts: true },
			fields: [
				{ name: 'headline', type: 'text' },
				{ name: 'face', type: 'relationship', relationTo: 'customers' },
			],
		},
	],
})

/**
 * A booted instance with a signed-in reviewer and the lookups every suite needs. `options`
 * replace the shared plugin options for a suite that needs the plugin set up differently.
 */
export const bootDedupe = async (db: SupportedDb, options?: Partial<DedupePluginOptions>) => {
	const booted: BootedPayload = await bootPayload({
		plugin: options ? dedupe({ ...pluginOptions, ...options }) : plugin,
		db,
		collections: collectionsFor(db),
		configOverrides: configOverrides(),
	})
	const req = await reqFor(booted, 'reviewer@example.com')

	/** Key rows of a document; name its collection where ids repeat across tables, as in SQL. */
	const keysFor = async (id: number | string, target?: string) =>
		(
			await booted.payload.db.find<{ key: string }>({
				collection: KEYS_SLUG,
				where: {
					and: [
						{ doc: { equals: String(id) } },
						...(target ? [{ target: { equals: target } }] : []),
					],
				},
				pagination: false,
			})
		).docs

	const pairsFor = async (id: number | string) =>
		(
			await booted.payload.db.find({
				collection: PAIRS_SLUG,
				where: { or: [{ docA: { equals: String(id) } }, { docB: { equals: String(id) } }] },
				pagination: false,
			})
		).docs as unknown as PairRow[]

	const customer = (data: Record<string, unknown>, locale?: string) =>
		booted.payload.create({
			collection: CUSTOMERS,
			data: data as never,
			...(locale ? { locale: locale as never } : {}),
			depth: 0,
		}) as Promise<Doc>

	return { booted, req, keysFor, pairsFor, customer }
}

/** A request signed in as a fresh user with this email. */
export const reqFor = async (booted: BootedPayload, email: string): Promise<PayloadRequest> => {
	const user = await booted.payload.create({
		collection: 'users' as CollectionSlug,
		data: { email, password: 'password' } as never,
	})
	return createLocalReq({ user: user as never }, booted.payload)
}
