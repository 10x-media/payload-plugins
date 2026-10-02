import { crc32, deflateSync } from 'node:zlib'
import { type CollectionSlug, createLocalReq, type GlobalSlug, type Payload } from 'payload'

import { PAIRS_SLUG } from '../../src/collections/slugs'
import { applyMerge } from '../../src/merge/apply'
import { getCollectionContext, getContext } from '../../src/plugin/context'
import { decidePair, type PairRow } from '../../src/queue/pairs'
import type { MergeChoice } from '../../src/schema/types'

export const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const TENANTS = 'tenants' as CollectionSlug
const CUSTOMERS = 'customers' as CollectionSlug
const COMPANIES = 'companies' as CollectionSlug
const LEADS = 'leads' as CollectionSlug
const ARTICLES = 'articles' as CollectionSlug
const PRODUCTS = 'products' as CollectionSlug

type Row = Record<string, unknown>

/** A small one-colour PNG, so the upload fields have images without files in the repo. */
const png = ([r, g, b]: [number, number, number]): Buffer => {
	const size = 48
	const row = Buffer.alloc(1 + size * 3)
	for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3)
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
		const head = Buffer.alloc(4)
		head.writeUInt32BE(data.length)
		const tail = Buffer.alloc(4)
		tail.writeUInt32BE(crc32(body) >>> 0)
		return Buffer.concat([head, body, tail])
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(size, 0)
	header.writeUInt32BE(size, 4)
	header.set([8, 2], 8)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
		chunk('IEND', Buffer.alloc(0)),
	])
}

/** A Lexical document of one paragraph. */
const richText = (text: string) => ({
	root: {
		type: 'root',
		format: '',
		indent: 0,
		version: 1,
		direction: 'ltr',
		children: [
			{
				type: 'paragraph',
				format: '',
				indent: 0,
				version: 1,
				direction: 'ltr',
				textFormat: 0,
				children: [
					{ type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 },
				],
			},
		],
	},
})

/**
 * Seed the dev Payload app: an admin, two offices as tenants, and customers, leads and
 * articles in each, some of them the same person or text entered twice. Each office has
 * its own mail domain and companies, so a list shows whose data it is. A few people exist
 * in both offices: the plugin must never pair them. Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const userCount = await payload.count({ collection: 'users' })
	if (userCount.totalDocs === 0) {
		await payload.create({
			collection: 'users',
			data: { email: DEV_EMAIL, password: DEV_PASSWORD },
		})
		payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)
	}

	const customerCount = await payload.count({ collection: CUSTOMERS })
	if (customerCount.totalDocs > 0) return

	// Without a transaction: the multi-tenant plugin validates every relationship with a query
	// of its own, which trips over the save's transaction on the in-memory replica set.
	const create = (collection: CollectionSlug, data: Row, draft = false) =>
		payload.create({
			collection,
			data: data as never,
			draft,
			disableTransaction: true,
		}) as Promise<{
			id: number | string
		}>

	const kyiv = (await create(TENANTS, { name: 'Kyiv Office', slug: 'kyiv' })).id
	const berlin = (await create(TENANTS, { name: 'Berlin Office', slug: 'berlin' })).id

	const dniproClub = (await create(COMPANIES, { name: 'Dnipro Paddle Club', tenant: kyiv })).id
	const kyivRowing = (await create(COMPANIES, { name: 'Kyiv Rowing School', tenant: kyiv })).id
	const spreeKanu = (await create(COMPANIES, { name: 'Spree Kanu GmbH', tenant: berlin })).id
	const havelBoats = (await create(COMPANIES, { name: 'Havel Boats', tenant: berlin })).id

	// Long values, with spaces and without, for every place a screen draws a title or a value.
	const LONG_NAME =
		'Maximilian Alexander Christopher Konstantin von Hohenzollern-Sigmaringen Wittelsbach'
	const UNBROKEN_NAME =
		'MaximilianAlexanderChristopherKonstantinVonHohenzollernSigmaringenWittelsbach'
	const LONG_TEXT = `A remarkably long description written to see how every screen wraps it. ${'It keeps going with ordinary words and spaces, sentence after sentence. '.repeat(4)}Then it stops.`
	const UNBROKEN_TEXT = `https://example.com/${'very-long-path-segment-without-any-spaces'.repeat(5)}`
	const longClub = (
		await create(COMPANIES, {
			name: 'The International Association of Recreational Paddlers, Rowers and Kayakers of the Greater Dnipro River Basin',
			tenant: kyiv,
		})
	).id
	const unbrokenClub = (
		await create(COMPANIES, {
			name: 'InternationalAssociationOfRecreationalPaddlersRowersAndKayakersOfTheDnipro',
			tenant: kyiv,
		})
	).id

	const customers: Row[] = [
		// Kyiv Office ------------------------------------------------------------------
		{
			tenant: kyiv,
			name: 'Ivan Petrenko',
			email: 'ivan@kyiv.example',
			phone: '+380 50 123 45 67',
			birthDate: '1998-04-12',
			tags: ['newsletter'],
			company: dniproClub,
			addresses: [{ city: 'Kyiv', street: 'Khreshchatyk 1' }],
			status: 'active',
		},
		{
			// Word order swapped, the phone written the local way: the same person.
			tenant: kyiv,
			name: 'Petrenko Ivan',
			email: 'i.petrenko@kyiv.example',
			phone: '0501234567',
			birthDate: '1998-04-12',
			tags: ['vip'],
			vip: true,
			profile: { bio: 'Paddler', score: 7 },
			status: 'active',
		},
		{
			// One letter off in the surname, no phone: the name keys make it a candidate, but with
			// one field in common it stays below `minScore`.
			tenant: kyiv,
			name: 'Ivan Petrenok',
			email: 'petrenok@kyiv.example',
			company: kyivRowing,
			status: 'lead',
		},
		{
			tenant: kyiv,
			name: 'Olga Koval',
			email: 'olga@kyiv.example',
			phone: '+380 67 555 12 12',
			birthDate: '1998-04-12',
			tags: ['newsletter'],
			status: 'active',
		},
		{
			// A look-alike that is someone else: shares a key, scores too low.
			tenant: kyiv,
			name: 'Olga Kovalenko',
			email: 'kovalenko@kyiv.example',
			birthDate: '1972-09-09',
			status: 'churned',
		},
		{
			tenant: kyiv,
			name: 'Andriy Shevchenko',
			email: 'andriy@kyiv.example',
			phone: '+380 93 700 07 07',
			birthDate: '1990-09-29',
			company: dniproClub,
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Shevchenko Andrii',
			email: 'a.shevchenko@kyiv.example',
			phone: '093 700 07 07',
			birthDate: '1990-09-29',
			status: 'lead',
		},
		{
			// One person entered three times: the seed merges the first two, which closes the
			// second one's pair with the third as superseded.
			tenant: kyiv,
			name: 'Oksana Bondar',
			email: 'oksana@kyiv.example',
			phone: '+380 67 222 33 44',
			birthDate: '1993-03-03',
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Bondar Oksana',
			email: 'o.bondar@kyiv.example',
			phone: '067 222 3344',
			birthDate: '1993-03-03',
			status: 'lead',
		},
		{
			tenant: kyiv,
			name: 'Oksana Bondar',
			email: 'bondar.oksana@kyiv.example',
			phone: '+380672223344',
			birthDate: '1993-03-03',
			status: 'lead',
		},
		{
			// One person entered five times, for a group merge wider than the screen's default.
			// Two of the entries hold a membership of the same club, which collides once both
			// move to whichever entry survives.
			tenant: kyiv,
			name: 'Mykola Bondarenko',
			email: 'mykola@kyiv.example',
			phone: '+380 97 333 44 55',
			birthDate: '1988-08-08',
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Bondarenko Mykola',
			email: 'm.bondarenko@kyiv.example',
			phone: '097 333 4455',
			birthDate: '1988-08-08',
			tags: ['newsletter'],
			status: 'lead',
		},
		{
			tenant: kyiv,
			name: 'Mykola Bondarenko',
			email: 'bondarenko.m@kyiv.example',
			phone: '+380973334455',
			birthDate: '1988-08-08',
			vip: true,
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Nikolai Bondarenko',
			email: 'nikolai@kyiv.example',
			phone: '0973334455',
			birthDate: '1988-08-08',
			company: dniproClub,
			status: 'churned',
		},
		{
			tenant: kyiv,
			name: 'Mykola Bondarenko',
			email: 'mykola.b@kyiv.example',
			phone: '+380 97 333 44 55',
			birthDate: '1988-08-08',
			profile: { bio: 'Rows on weekends', score: 4 },
			status: 'lead',
		},
		{
			// Found as a pair, then the second entry was corrected into someone else: stale.
			tenant: kyiv,
			name: 'Dmytro Melnyk',
			email: 'dmytro@kyiv.example',
			phone: '+380 63 111 22 33',
			birthDate: '1995-05-05',
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Melnyk Dmytro',
			email: 'melnyk.d@kyiv.example',
			phone: '063 111 2233',
			birthDate: '1995-05-05',
			status: 'lead',
		},
		{
			// The same person as in Berlin, phone and all: different tenants, never a pair.
			tenant: kyiv,
			name: 'Anna Schmidt',
			email: 'anna.schmidt@kyiv.example',
			phone: '+49 30 1234567',
			status: 'lead',
		},

		// Berlin Office ----------------------------------------------------------------
		{
			tenant: berlin,
			name: 'Anna Schmidt',
			email: 'anna@berlin.example',
			phone: '+49 30 1234567',
			addresses: [{ city: 'Berlin', street: 'Unter den Linden 5' }],
			profile: { score: 1 },
			status: 'active',
		},
		{
			tenant: berlin,
			name: 'Anna Schmidt',
			email: 'a.schmidt@berlin.example',
			phone: '030 1234567',
			company: spreeKanu,
			addresses: [
				{ city: 'Berlin', street: 'Unter den Linden 5' },
				{ city: 'Hamburg', street: 'Reeperbahn 2' },
			],
			profile: { bio: 'Second entry', score: 2 },
			status: 'active',
		},
		{
			// A spelling variant of the surname, same phone and birth date: a `similar` name.
			tenant: berlin,
			name: 'Thomas Müller',
			email: 'thomas@berlin.example',
			phone: '+49 171 555 0101',
			birthDate: '1979-02-14',
			company: havelBoats,
			status: 'active',
		},
		{
			tenant: berlin,
			name: 'Thomas Mueller',
			email: 'tmueller@berlin.example',
			phone: '0171 5550101',
			birthDate: '1979-02-14',
			vip: true,
			status: 'active',
		},
		{
			// Accents and word order: the same person typed on two keyboards.
			tenant: berlin,
			name: 'María García',
			email: 'maria@berlin.example',
			phone: '+34 612 345 678',
			birthDate: '1985-11-23',
			tags: ['newsletter'],
			status: 'lead',
		},
		{
			tenant: berlin,
			name: 'Garcia Maria',
			email: 'm.garcia@berlin.example',
			phone: '612345678',
			birthDate: '1985-11-23',
			company: spreeKanu,
			status: 'active',
		},
		{
			// Day and month swapped: the transposed date shares a key, so the two are
			// compared, but it counts as a difference and the pair stays below `minScore`.
			tenant: berlin,
			name: 'Sophie Martin',
			email: 'sophie@berlin.example',
			phone: '+33 6 12 34 56 78',
			birthDate: '1990-03-07',
			status: 'active',
		},
		{
			tenant: berlin,
			name: 'Sophie Martin',
			email: 'sophie.martin@berlin.example',
			phone: '06 12 34 56 78',
			birthDate: '1990-07-03',
			tags: ['vip'],
			status: 'active',
		},
		{
			// Punctuation in the name only.
			tenant: berlin,
			name: 'Jean-Luc Picard',
			email: 'picard@berlin.example',
			phone: '+33 1 40 20 50 50',
			status: 'churned',
		},
		{
			tenant: berlin,
			name: 'Jean Luc Picard',
			email: 'jl.picard@berlin.example',
			phone: '01 40 20 50 50',
			company: havelBoats,
			status: 'active',
		},
		{
			tenant: berlin,
			name: 'Anna Becker',
			email: 'becker@berlin.example',
			phone: '+49 89 7654321',
			birthDate: '2001-06-30',
			status: 'active',
		},
		{
			// The same person as in Kyiv: different tenants, never a pair.
			tenant: berlin,
			name: 'Ivan Petrenko',
			email: 'ivan.petrenko@berlin.example',
			phone: '+380 50 123 45 67',
			birthDate: '1998-04-12',
			status: 'lead',
		},
		// Merged by the seed below, for the merge history: a group of three, a unique email
		// taken over, a unique number taken over, and a pair in the Berlin office.
		{
			tenant: kyiv,
			name: 'Olena Kravets',
			email: 'olena@kyiv.example',
			phone: '+380 63 555 12 12',
			birthDate: '1988-11-02',
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Kravets Olena',
			email: 'kravets.olena@kyiv.example',
			phone: '063 555 1212',
			birthDate: '1988-11-02',
			tags: ['newsletter'],
			status: 'lead',
		},
		{
			tenant: kyiv,
			name: 'Olena Kravets',
			email: 'o.kravets@kyiv.example',
			phone: '+380635551212',
			birthDate: '1988-11-02',
			vip: true,
			status: 'lead',
		},
		{
			tenant: kyiv,
			name: 'Petro Shevchuk',
			email: 'petro@kyiv.example',
			phone: '067 404 40 40',
			birthDate: '1979-06-15',
			status: 'lead',
		},
		{
			tenant: kyiv,
			name: 'Shevchuk Petro',
			email: 'shevchuk@kyiv.example',
			phone: '+380 67 404 4040',
			birthDate: '1979-06-15',
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Iryna Tkachenko',
			email: 'iryna@kyiv.example',
			phone: '095 321 00 11',
			birthDate: '1995-02-14',
			status: 'active',
		},
		{
			tenant: kyiv,
			name: 'Tkachenko Iryna',
			email: 'tkachenko@kyiv.example',
			phone: '+380 95 321 0011',
			birthDate: '1995-02-14',
			status: 'lead',
		},
		{
			tenant: berlin,
			name: 'Hans Weber',
			email: 'hans@berlin.example',
			phone: '+49 30 1234567',
			birthDate: '1970-01-20',
			status: 'active',
		},
		{
			tenant: berlin,
			name: 'Weber Hans',
			email: 'h.weber@berlin.example',
			phone: '030 1234567',
			birthDate: '1970-01-20',
			status: 'lead',
		},
		{
			// Long values in every field a screen draws: a group spaced, a pair unbroken, and an
			// unbroken pair merged for the history.
			tenant: kyiv,
			name: LONG_NAME,
			email: 'long.a@kyiv.example',
			phone: '+380 50 777 88 99',
			birthDate: '1979-07-07',
			note: LONG_TEXT,
			profile: { bio: UNBROKEN_TEXT, score: 1 },
			company: longClub,
			status: 'active',
		},
		{
			tenant: kyiv,
			name: LONG_NAME,
			email: 'long.b@kyiv.example',
			phone: '050 777 8899',
			birthDate: '1979-07-07',
			note: UNBROKEN_TEXT,
			profile: { bio: LONG_TEXT, score: 2 },
			tags: [
				'a-very-long-tag-without-any-spaces-that-keeps-going-and-going-and-going',
				'a long tag with spaces that goes on and on and on and on',
			],
			company: unbrokenClub,
			addresses: [{ city: LONG_NAME, street: UNBROKEN_TEXT }],
			status: 'lead',
		},
		{
			tenant: kyiv,
			name: `${LONG_NAME} Junior`,
			email: 'long.c@kyiv.example',
			phone: '+380507778899',
			birthDate: '1979-07-07',
			status: 'churned',
		},
		{
			tenant: kyiv,
			name: UNBROKEN_NAME,
			email: 'unbroken.a@kyiv.example',
			phone: '+380 50 666 55 44',
			birthDate: '1980-08-08',
			note: UNBROKEN_TEXT,
		},
		{
			tenant: kyiv,
			name: UNBROKEN_NAME,
			email: 'unbroken.b@kyiv.example',
			phone: '0506665544',
			birthDate: '1980-08-08',
			note: LONG_TEXT,
			profile: { bio: UNBROKEN_TEXT },
		},
		{
			tenant: kyiv,
			name: `${UNBROKEN_NAME}Merged`,
			email: 'merged.a@kyiv.example',
			phone: '+380 50 555 44 33',
			birthDate: '1981-09-09',
			note: UNBROKEN_TEXT,
		},
		{
			tenant: kyiv,
			name: `${UNBROKEN_NAME}Merged`,
			email: 'merged.b@kyiv.example',
			phone: '0505554433',
			birthDate: '1981-09-09',
			note: LONG_TEXT,
		},
	]
	const byEmail = new Map<string, number | string>()
	for (const [index, row] of customers.entries()) {
		const doc = await create(CUSTOMERS, { ...row, customerNumber: 1001 + index })
		byEmail.set(String(row.email), doc.id)
	}
	const customer = (email: string) => byEmail.get(email) as number | string

	// Documents pointing at customers, moved to the survivor on a merge. Kyiv's Ivan pair
	// also shares a club membership, which blocks that merge until one is removed.
	const ORDERS = 'orders' as CollectionSlug
	const MEMBERSHIPS = 'memberships' as CollectionSlug
	const TRIPS = 'trips' as CollectionSlug
	const NOTES = 'notes' as CollectionSlug
	const ivan = customer('ivan@kyiv.example')
	const petrenko = customer('i.petrenko@kyiv.example')
	const thomas = customer('thomas@berlin.example')
	const mueller = customer('tmueller@berlin.example')
	for (const [tenant, number, owner, items] of [
		[kyiv, 'K-1001', ivan, []],
		[kyiv, 'K-1002', petrenko, [{ product: 'Carbon paddle', handledBy: petrenko }]],
		[kyiv, 'K-1003', petrenko, []],
		[berlin, 'B-2001', thomas, []],
		[berlin, 'B-2002', mueller, [{ product: 'Spray deck', handledBy: mueller }]],
	] as const) {
		await create(ORDERS, { tenant, number, customer: owner, items })
	}
	await create(MEMBERSHIPS, {
		tenant: kyiv,
		title: 'Ivan in Dnipro Paddle Club',
		customer: ivan,
		club: dniproClub,
	})
	await create(MEMBERSHIPS, {
		tenant: kyiv,
		title: 'Petrenko in Dnipro Paddle Club',
		customer: petrenko,
		club: dniproClub,
	})
	await create(MEMBERSHIPS, {
		tenant: berlin,
		title: 'Mueller in Havel Boats',
		customer: mueller,
		club: havelBoats,
	})
	await create(TRIPS, { tenant: kyiv, title: 'Dnipro weekend', participants: [ivan, petrenko] })
	await create(TRIPS, { tenant: berlin, title: 'Spreewald tour', participants: [mueller] })
	await payload.updateGlobal({
		slug: 'site' as GlobalSlug,
		data: { featuredCustomer: mueller } as never,
	})
	await create(MEMBERSHIPS, {
		tenant: kyiv,
		title: 'Bondarenko in Kyiv Rowing School',
		customer: customer('m.bondarenko@kyiv.example'),
		club: kyivRowing,
	})
	await create(MEMBERSHIPS, {
		tenant: kyiv,
		title: 'Mykola in Kyiv Rowing School',
		customer: customer('bondarenko.m@kyiv.example'),
		club: kyivRowing,
	})
	await create(ORDERS, {
		tenant: kyiv,
		number: 'K-1004',
		customer: customer('nikolai@kyiv.example'),
	})
	await create(TRIPS, {
		tenant: kyiv,
		title: 'Desna kayak day',
		participants: [customer('mykola@kyiv.example'), customer('mykola.b@kyiv.example')],
	})
	await create(MEMBERSHIPS, {
		tenant: kyiv,
		title: `${LONG_NAME} in the International Association of Recreational Paddlers`,
		customer: customer('long.a@kyiv.example'),
		club: longClub,
	})
	await create(TRIPS, {
		tenant: kyiv,
		title:
			'A very long weekend trip down the Dnipro from Kyiv to Kaniv and back again, with every stop on the way',
		participants: [customer('long.a@kyiv.example'), customer('long.b@kyiv.example')],
	})
	await create(ORDERS, {
		tenant: kyiv,
		number: `K-${'0123456789'.repeat(6)}`,
		customer: customer('long.b@kyiv.example'),
	})
	await create(NOTES, {
		tenant: berlin,
		text: 'Asked about a winter course',
		about: { relationTo: 'customers', value: mueller },
		_status: 'published',
	})
	await create(NOTES, {
		tenant: kyiv,
		text: 'Club contact',
		about: { relationTo: 'companies', value: dniproClub },
		_status: 'published',
	})

	// Every state a pair can be in, reached the way the admin reaches it.
	const reviewer = (
		await payload.find({ collection: 'users', where: { email: { equals: DEV_EMAIL } }, limit: 1 })
	).docs[0]
	const req = await createLocalReq({ user: reviewer as never }, payload)
	const ctx = getContext(payload)
	const pairOf = async (a: number | string, b: number | string) => {
		const [x, y] = [String(a), String(b)]
		return (await payload.db.findOne({
			collection: PAIRS_SLUG,
			where: {
				or: [
					{ and: [{ docA: { equals: x } }, { docB: { equals: y } }] },
					{ and: [{ docA: { equals: y } }, { docB: { equals: x } }] },
				],
			},
		})) as PairRow | null
	}
	const picard = await pairOf(
		customer('picard@berlin.example'),
		customer('jl.picard@berlin.example')
	)
	if (picard) await decidePair({ req, ctx, pair: picard, status: 'dismissed' })
	/** Merges a group into its first document. */
	const mergeGroup = (args: {
		collection: CollectionSlug
		ids: (number | string)[]
		choices?: (ids: string[]) => Record<string, MergeChoice>
	}) => {
		const [survivorId, ...absorbedIds] = args.ids.map(String) as [string, ...string[]]
		return applyMerge({
			req,
			ctx,
			col: getCollectionContext(payload, args.collection),
			survivorId,
			absorbedIds,
			choices: args.choices?.([survivorId, ...absorbedIds]) ?? {},
		})
	}
	await mergeGroup({
		collection: CUSTOMERS,
		ids: [customer('oksana@kyiv.example'), customer('o.bondar@kyiv.example')],
	})
	const kravets = [
		customer('olena@kyiv.example'),
		customer('kravets.olena@kyiv.example'),
		customer('o.kravets@kyiv.example'),
	]
	await create(ORDERS, { tenant: kyiv, number: 'K-1005', customer: kravets[1] })
	await create(TRIPS, { tenant: kyiv, title: 'Trukhaniv island loop', participants: [kravets[2]] })
	await mergeGroup({
		collection: CUSTOMERS,
		ids: kravets,
		choices: ([, , third]) => ({
			phone: { doc: third as string },
			vip: { doc: third as string },
		}),
	})
	// The survivor takes the absorbed email, so the absorbed one keeps a placeholder.
	await mergeGroup({
		collection: CUSTOMERS,
		ids: [customer('petro@kyiv.example'), customer('shevchuk@kyiv.example')],
		choices: ([, absorbed]) => ({ email: { doc: absorbed as string } }),
	})
	// A number can hold no placeholder, and Mongo no second empty value: the absorbed
	// customer is deleted instead of trashed.
	await mergeGroup({
		collection: CUSTOMERS,
		ids: [customer('iryna@kyiv.example'), customer('tkachenko@kyiv.example')],
		choices: ([, absorbed]) => ({ customerNumber: { doc: absorbed as string } }),
	})
	await mergeGroup({
		collection: CUSTOMERS,
		ids: [customer('hans@berlin.example'), customer('h.weber@berlin.example')],
	})
	await payload.update({
		collection: CUSTOMERS,
		id: customer('melnyk.d@kyiv.example'),
		data: { name: 'Taras Hnatyuk', phone: '+380 99 000 00 00' } as never,
		disableTransaction: true,
	})

	// One author entered four times, every kind of field Payload has filled in differently:
	// the merge screen shows each one. The first leaves a few fields empty, which the newest
	// entry fills in; the first and the last share some values, which "only differences"
	// hides.
	const SPECIMENS = 'specimens' as CollectionSlug
	const image = async (name: string, colour: [number, number, number]) => {
		const data = png(colour)
		const doc = await payload.create({
			collection: 'media' as CollectionSlug,
			data: { alt: name } as never,
			file: { data, mimetype: 'image/png', name: `${name}.png`, size: data.length },
			disableTransaction: true,
		})
		return doc.id
	}
	const [avatarA, avatarB, avatarC, heroImage] = [
		await image('avatar-blue', [59, 130, 246]),
		await image('avatar-green', [34, 197, 94]),
		await image('avatar-amber', [245, 158, 11]),
		await image('hero-rose', [244, 63, 94]),
	]
	const specimens: Row[] = [
		{
			tenant: kyiv,
			title: 'Er Gen',
			email: 'ergen@specimens.test',
			bio: 'Chinese novelist, author of Beyond Time. Publishing since 2009.',
			age: 42,
			birthDate: '1981-03-02',
			level: 'senior',
			skills: ['ts', 'sql'],
			contactBy: 'email',
			active: true,
			company: dniproClub,
			friends: [ivan, petrenko],
			about: { relationTo: 'companies', value: dniproClub },
			avatar: avatarA,
			notes: richText('Writes xianxia since 2009.'),
			settings: { theme: 'dark', notify: true },
			aliases: ['ergen', 'er-gen'],
			scores: [7, 9],
			links: [
				{ label: 'Webnovel', url: 'webnovel.com/profile/ergen', caption: 'Serial novels' },
				{ label: 'Twitter', url: 'x.com/ergen_official', caption: 'News' },
			],
			publications: [
				{
					title: 'Beyond Time',
					publisher: dniproClub,
					year: 2021,
					editions: [
						{ format: 'print', isbn: '978-1-0001-0001-1' },
						{ format: 'ebook', isbn: '978-1-0001-0002-8' },
					],
				},
				{
					title: 'A Will Eternal',
					publisher: kyivRowing,
					year: 2016,
					editions: [{ format: 'print', isbn: '978-1-0002-0001-0' }],
				},
				{ title: 'I Shall Seal the Heavens', publisher: dniproClub, year: 2014 },
			],
			layout: [
				{ blockType: 'hero', heading: 'Master of Xianxia', image: heroImage },
				{ blockType: 'quote', text: 'The road to immortality is long.', author: 'Er Gen' },
				{
					blockType: 'section',
					heading: 'Books',
					content: [
						{ blockType: 'paragraph', text: 'Five long series since 2009.' },
						{ blockType: 'cta', label: 'Ask the agent', contact: ivan },
					],
				},
			],
			address: { city: 'Kyiv', street: 'Khreshchatyk 1' },
			social: { twitter: '@ergen' },
			motto: 'Write every day',
			summary: 'Author of long fantasy series.',
			secret: 'kept on the survivor',
		},
		{
			tenant: kyiv,
			title: 'Er Gén',
			email: 'er.gen@specimens.test',
			bio: 'Chinese novelist of xianxia, known for A Will Eternal and Beyond Time.',
			age: 42,
			birthDate: '1981-03-02',
			level: 'middle',
			skills: ['ts', 'go'],
			contactBy: 'phone',
			active: false,
			company: kyivRowing,
			friends: [ivan],
			about: { relationTo: 'customers', value: ivan },
			avatar: avatarB,
			notes: richText('Author of A Will Eternal.'),
			settings: { theme: 'light' },
			location: [30.53, 50.44],
			snippet: "export const greet = (name: string) => 'Hi, ' + name",
			aliases: ['ergen'],
			scores: [9],
			links: [
				{ label: 'Webnovel', url: 'webnovel.com/profile/ergen', caption: 'Serial novels' },
				{ label: 'Weibo', url: 'weibo.com/ergen', caption: 'Fan page' },
			],
			publications: [
				{
					title: 'Beyond Time',
					publisher: dniproClub,
					year: 2021,
					editions: [
						{ format: 'print', isbn: '978-1-0001-0001-1' },
						{ format: 'ebook', isbn: '978-1-0001-0002-8' },
					],
				},
				{
					title: 'A Will Eternal',
					publisher: kyivRowing,
					year: 2016,
					editions: [
						{ format: 'print', isbn: '978-1-0002-0001-0' },
						{ format: 'audio', isbn: '978-1-0002-0003-4' },
					],
				},
				{ title: 'Renegade Immortal', publisher: kyivRowing, year: 2009 },
				{
					title: 'Pursuit of the Truth',
					year: 2009,
					editions: [{ format: 'ebook', isbn: '978-1-0003-0002-5' }],
				},
				{ title: 'A World Worth Protecting', publisher: dniproClub, year: 2020 },
			],
			layout: [
				{ blockType: 'hero', heading: 'Author of A Will Eternal', image: heroImage },
				{
					blockType: 'section',
					heading: 'Books',
					content: [
						{ blockType: 'paragraph', text: 'Five long series and short stories since 2009.' },
						{ blockType: 'cta', label: 'Write to the agent', contact: petrenko },
					],
				},
			],
			address: { city: 'Kyiv', street: 'Khreshchatyk 2' },
			social: { twitter: '@ergen_official' },
			motto: 'Write every day!',
			summary: 'Author of long fantasy series and short stories.',
		},
		{
			tenant: kyiv,
			title: 'Ergen',
			birthDate: '1981-03-02',
			level: 'senior',
			active: true,
			avatar: avatarC,
			links: [{ label: 'Qidian', url: 'qidian.com/author/4362' }],
			motto: 'Write every day',
		},
		{
			tenant: kyiv,
			title: 'Er Gen',
			email: 'ergen.author@specimens.test',
			bio: 'Chinese novelist, author of Beyond Time. Publishing since 2009.',
			age: 43,
			birthDate: '1981-03-02',
			level: 'senior',
			skills: ['sql', 'css'],
			contactBy: 'email',
			active: true,
			company: dniproClub,
			friends: [petrenko, customer('olga@kyiv.example')],
			about: { relationTo: 'companies', value: kyivRowing },
			avatar: avatarA,
			notes: richText('Writes xianxia since 2009. Lives in Kyiv.'),
			settings: { theme: 'dark', notify: false },
			location: [30.52, 50.45],
			snippet: "export const greet = (name: string) => 'Hello, ' + name",
			aliases: ['er-gen', 'ergen-author'],
			scores: [7, 9, 10],
			links: [{ label: 'Webnovel', url: 'webnovel.com/profile/ergen' }],
			publications: [{ title: 'Beyond Time', publisher: kyivRowing, year: 2022 }],
			layout: [{ blockType: 'quote', text: 'Cultivate the heart first.', author: 'Er Gen' }],
			address: { city: 'Kyiv', street: 'Khreshchatyk 1' },
			social: { twitter: '@ergen' },
			motto: 'Write every day',
			summary: 'Author of long fantasy series.',
		},
	]
	for (const row of specimens) {
		const doc = await create(SPECIMENS, row)
		await payload.update({
			collection: SPECIMENS,
			id: doc.id,
			locale: 'de',
			data: {
				motto: `${String(row.motto)} (de)`,
				summary: 'Autor langer Fantasy-Reihen.',
			} as never,
			disableTransaction: true,
		})
	}

	// The same four entries under another name, merged with values taken from each of them,
	// so a merge record in the history shows every kind of field.
	const copies: string[] = []
	for (const [index, row] of specimens.entries()) {
		const doc = await create(SPECIMENS, {
			...row,
			title: 'Lin Qi',
			...(row.email ? { email: String(row.email).replace('@', '.copy@') } : {}),
		})
		if (index < 2) {
			await payload.update({
				collection: SPECIMENS,
				id: doc.id,
				locale: 'de',
				data: {
					motto: index === 0 ? 'Jeden Tag schreiben' : 'Jeden Tag schreiben!',
					summary:
						index === 0 ? 'Autor langer Fantasy-Reihen.' : 'Autor von Fantasy und Kurzgeschichten.',
				} as never,
				disableTransaction: true,
			})
		}
		copies.push(String(doc.id))
	}
	await mergeGroup({
		collection: SPECIMENS,
		ids: copies,
		choices: ([a, b, c, d]) => {
			const [first, second, third, fourth] = [a, b, c, d] as [string, string, string, string]
			return {
				bio: { doc: second },
				age: { doc: fourth },
				level: { doc: second },
				contactBy: { doc: second },
				company: { doc: second },
				about: { doc: second },
				avatar: { doc: third },
				notes: { doc: second },
				settings: { doc: second },
				email: { doc: fourth },
				skills: {
					items: [
						{ doc: first, index: 0 },
						{ doc: second, index: 1 },
						{ doc: fourth, index: 1 },
					],
				},
				scores: {
					items: [
						{ doc: first, index: 0 },
						{ doc: first, index: 1 },
					],
				},
				links: {
					items: [
						{ doc: first, index: 0 },
						{ doc: second, index: 1 },
						{ doc: third, index: 0 },
					],
				},
				publications: {
					items: [
						{ doc: first, index: 0 },
						{ doc: second, index: 3 },
						{ doc: second, index: 4 },
					],
				},
				layout: { doc: second },
				'address.street': { doc: second },
				'social.twitter': { doc: second },
				'motto@de': { doc: second },
				'summary@en': { doc: second },
			}
		},
	})

	// A second, smaller author pair, already merged, for the history.
	const mira = [
		await create(SPECIMENS, {
			tenant: berlin,
			title: 'Mira Sol',
			email: 'mira@specimens.test',
			bio: 'Poet from Lisbon.',
			level: 'middle',
			skills: ['css'],
			active: true,
			avatar: avatarB,
		}),
		await create(SPECIMENS, {
			tenant: berlin,
			title: 'Mira Sol',
			email: 'mira.sol@specimens.test',
			bio: 'Poet and translator from Lisbon.',
			level: 'senior',
			skills: ['css', 'ts'],
			aliases: ['mira'],
			avatar: avatarC,
		}),
	].map((doc) => doc.id)
	await mergeGroup({
		collection: SPECIMENS,
		ids: mira,
		choices: ([, absorbed]) => ({
			bio: { doc: absorbed as string },
			level: { doc: absorbed as string },
		}),
	})

	// Long titles in the history and on a merge record.
	await mergeGroup({
		collection: CUSTOMERS,
		ids: [customer('merged.a@kyiv.example'), customer('merged.b@kyiv.example')],
	})
	const LONG_TITLE =
		'The Extraordinarily Long Chronicle of the Wandering Scholar Who Crossed Seven Rivers and Nine Mountains'
	const UNBROKEN_TITLE = 'TheExtraordinarilyLongChronicleOfTheWanderingScholarWhoCrossedSevenRivers'
	for (const row of [
		{
			title: LONG_TITLE,
			email: 'long.title@specimens.test',
			bio: LONG_TEXT,
			aliases: [
				'an-alias-that-has-no-spaces-and-refuses-to-end-anywhere-soon-at-all',
				'an alias with spaces that also goes on and on',
			],
			links: [{ label: LONG_NAME, url: UNBROKEN_TEXT }],
			publications: [
				{
					title: LONG_TEXT.slice(0, 160),
					publisher: longClub,
					year: 2024,
					editions: [{ format: 'print', isbn: UNBROKEN_TEXT.slice(0, 90) }],
				},
			],
			layout: [
				{
					blockType: 'section',
					heading: LONG_TITLE,
					content: [
						{ blockType: 'paragraph', text: LONG_TEXT },
						{ blockType: 'cta', label: UNBROKEN_NAME, contact: customer('long.a@kyiv.example') },
					],
				},
			],
			motto: LONG_NAME,
			summary: LONG_TEXT,
		},
		{
			title: LONG_TITLE,
			email: 'long.title2@specimens.test',
			bio: UNBROKEN_TEXT,
			links: [{ label: UNBROKEN_NAME, url: UNBROKEN_TEXT }],
			publications: [{ title: UNBROKEN_NAME, publisher: unbrokenClub, year: 2025 }],
			motto: UNBROKEN_NAME,
			summary: UNBROKEN_TEXT,
		},
		{ title: UNBROKEN_TITLE, email: 'unbroken.title@specimens.test', bio: UNBROKEN_TEXT },
		{ title: UNBROKEN_TITLE, email: 'unbroken.title2@specimens.test', bio: LONG_TEXT },
	]) {
		await create(SPECIMENS, { tenant: kyiv, ...row })
	}

	// No match config on leads: these are merged by hand from the list.
	for (const lead of [
		{ tenant: kyiv, email: 'lead@kyiv.example', source: 'Website form' },
		{ tenant: kyiv, email: 'lead@kyiv.example', source: 'Trade fair' },
		{ tenant: kyiv, email: 'someone@kyiv.example', source: 'Newsletter' },
		{ tenant: berlin, email: 'lead@berlin.example', source: 'Website form' },
		{ tenant: berlin, email: 'lead@berlin.example', source: 'Partner referral' },
	]) {
		await create(LEADS, lead)
	}

	// Drafts on: some are published, some only drafts, and a few say the same thing twice.
	for (const article of [
		// Long titles and summaries, spaced and unbroken, for the form's duplicates panel.
		{ tenant: kyiv, title: LONG_TITLE, summary: LONG_TEXT, _status: 'published' },
		{ tenant: kyiv, title: LONG_TITLE, summary: LONG_TEXT, _status: 'published' },
		{ tenant: kyiv, title: UNBROKEN_TITLE, summary: UNBROKEN_TEXT, _status: 'published' },
		{ tenant: kyiv, title: UNBROKEN_TITLE, summary: UNBROKEN_TEXT, _status: 'published' },
		{
			tenant: kyiv,
			title: 'Paddling the Dnipro',
			summary: 'A week on the river.',
			_status: 'published',
		},
		{
			tenant: kyiv,
			title: 'Paddling the Dnipro',
			summary: 'Seven days on the river.',
			_status: 'published',
		},
		{
			tenant: kyiv,
			title: 'Choosing your first canoe',
			summary: 'Length, width and material.',
			_status: 'draft',
		},
		{
			tenant: berlin,
			title: 'Kayak safety basics',
			summary: 'What to wear and what to carry.',
			_status: 'published',
		},
		{
			tenant: berlin,
			title: 'Kayak Safety: the basics',
			summary: 'What to wear, what to carry.',
			_status: 'draft',
		},
		{
			tenant: berlin,
			title: 'Winter paddling',
			summary: 'Cold water needs a different plan.',
			_status: 'published',
		},
		// The Kyiv title again in Berlin: different tenants, never a pair.
		{
			tenant: berlin,
			title: 'Paddling the Dnipro',
			summary: 'A week on the river.',
			_status: 'published',
		},
	]) {
		await create(ARTICLES, article, article._status === 'draft')
	}

	// Each number rule on its own: the same SKU, a barcode with one digit off (1 of 13 is within
	// 10%) and one with two swapped (past it), a price 3% apart and one 6% apart (past the 5%).
	for (const product of [
		{ name: 'Trail Running Shoe', sku: 40001, barcode: 4006381333931, price: 129 },
		{ name: 'Trail running shoe', sku: 40001, barcode: 4006381333932, price: 125 },
		{ name: 'Road Running Shoe', sku: 40002, barcode: 4006381334006, price: 99 },
		{ name: 'Rain Jacket', sku: 50010, barcode: 5901234123457, price: 89.9 },
		{ name: 'Rain Jacket', sku: 50011, barcode: 5901234123457, price: 95.5 },
		{ name: 'Bike Helmet', sku: 60020, barcode: 8712345678906, price: 64 },
		{ name: 'Helmet', sku: 61020, barcode: 8712345678960, price: 64 },
		{ name: 'Kayak Paddle', sku: 70001, barcode: 7612345000017, price: 150 },
		{ name: 'Kayak Paddle', sku: 70001, barcode: 7612345000017, price: 150 },
	]) {
		await create(PRODUCTS, { ...product, tenant: kyiv })
	}
	// The same paddle in the other office: never a pair.
	await create(PRODUCTS, {
		name: 'Kayak Paddle',
		sku: 70001,
		barcode: 7612345000017,
		price: 150,
		tenant: berlin,
	})
	payload.logger.info('Seeded dev tenants, customers, leads, articles and products')
}
