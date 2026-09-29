import { createLocalReq, type Payload, type Where } from 'payload'

import { postMessage } from '../../src/index'

const DEV_EMAIL = 'dev@10xmedia.de'
const DEV_PASSWORD = 'password'

const LINES = [
	'The federation sent the passport scan, the club confirmation and the medical form in one email.',
	'I split them into separate uploads so each one can be reviewed.',
	'Medical form is from last season, we need the current one.',
	'Asked the club for a new one, they said end of the week.',
	'Heat times need a final check before we publish.',
	'Photo is missing too, I asked the partner for one.',
	'Title fixed. Running the translation once the image lands.',
	'Can someone double check the date of birth? It differs from the licence.',
]

const ensureUser = async (
	payload: Payload,
	{
		collection,
		email,
		name,
		tenants = [],
	}: { collection: 'customers' | 'users'; email: string; name: string; tenants?: string[] }
) => {
	const found = await payload.find({ collection, limit: 1, where: { email: { equals: email } } })
	if (found.docs[0]) return found.docs[0]
	const data =
		collection === 'users'
			? { tenants: tenants.map((tenant) => ({ tenant })) }
			: { tenant: tenants[0] ?? null }
	return payload.create({
		collection,
		data: { email, name, password: DEV_PASSWORD, ...data } as never,
	})
}

const ensureTenant = async (payload: Payload, name: string): Promise<string> => {
	const found = await payload.find({
		collection: 'tenants',
		limit: 1,
		where: { name: { equals: name } },
	})
	const doc = found.docs[0] ?? (await payload.create({ collection: 'tenants', data: { name } }))
	return String(doc.id)
}

/**
 * Seed the dev app: two tenants; staff (log in as the first, who sees every
 * tenant; Anna is in both, Marc only in Rowing); a customer per tenant; a
 * person per tenant; and one conversation long enough to page through (130
 * messages, a thread, a mention). Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const canoe = await ensureTenant(payload, 'Canoe Federation')
	const rowing = await ensureTenant(payload, 'Rowing Club')
	const me = await ensureUser(payload, {
		collection: 'users',
		email: DEV_EMAIL,
		name: 'Roman Palamar',
	})
	const anna = await ensureUser(payload, {
		collection: 'users',
		email: 'anna@10xmedia.de',
		name: 'Anna Keller',
		tenants: [canoe, rowing],
	})
	const marc = await ensureUser(payload, {
		collection: 'users',
		email: 'marc@10xmedia.de',
		name: 'Marc Oliveira',
		tenants: [rowing],
	})
	const customer = await ensureUser(payload, {
		collection: 'customers',
		email: 'customer@example.com',
		name: 'Czech Canoe',
		tenants: [canoe],
	})
	await ensureUser(payload, {
		collection: 'customers',
		email: 'rowers@example.com',
		name: 'River Rowers',
		tenants: [rowing],
	})

	await seedChat(payload, { anna: String(anna.id), marc: String(marc.id), me: String(me.id) })
	await seedTickets(payload, {
		anna: String(anna.id),
		customer: String(customer.id),
		me: String(me.id),
	})
	await seedProjects(payload, { anna: String(anna.id), me: String(me.id) })

	if ((await payload.count({ collection: 'persons' })).totalDocs > 0) return
	payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)

	const athlete = await payload.create({
		collection: 'persons',
		data: { name: 'Jana Nováková', owner: customer.id, tenant: canoe } as never,
	})
	await payload.create({
		collection: 'persons',
		data: { name: 'Tomás Ruiz', tenant: rowing } as never,
	})
	await payload.create({ collection: 'media', data: { title: 'Passport scan' } })

	const key = `collection:persons:${athlete.id}`
	const req = await createLocalReq({}, payload)
	const authors = [`users:${anna.id}`, `users:${me.id}`]
	for (let index = 0; index < 120; index++) {
		await postMessage(req, {
			author: authors[index % 3 === 0 ? 1 : 0],
			channel: 'internal',
			instance: 'comments',
			key,
			text: `${LINES[index % LINES.length]} (#${index + 1})`,
		})
	}
	const root = await postMessage(req, {
		author: `users:${anna.id}`,
		body: {
			root: {
				children: [
					{
						children: [
							{
								detail: 0,
								format: 0,
								mode: 'normal',
								style: '',
								text: 'Heads up ',
								type: 'text',
								version: 1,
							},
							{
								label: 'Roman Palamar',
								type: 'conversationsMention',
								userKey: `users:${me.id}`,
								version: 1,
							},
							{
								detail: 0,
								format: 0,
								mode: 'normal',
								style: '',
								text: ', the English intro still says "Ereasmus".',
								type: 'text',
								version: 1,
							},
						],
						direction: 'ltr',
						format: '',
						indent: 0,
						textFormat: 0,
						type: 'paragraph',
						version: 1,
					},
				],
				direction: 'ltr',
				format: '',
				indent: 0,
				type: 'root',
				version: 1,
			},
		},
		channel: 'internal',
		instance: 'comments',
		key,
	})
	for (const [author, text] of [
		[`users:${me.id}`, 'Confirmed, the partner writes it "Erasmus+".'],
		[`users:${anna.id}`, 'Great, I will review German and Ukrainian myself.'],
	] as const) {
		await postMessage(req, {
			author,
			channel: 'internal',
			instance: 'comments',
			key,
			parent: String(root.id),
			text,
		})
	}
	await postMessage(req, {
		author: `users:${me.id}`,
		channel: 'internal',
		data: { from: 'draft', to: 'in review' },
		instance: 'comments',
		key,
		type: 'person.status',
	})
	// Written by no person: an import leaves a note behind (`layout: 'bare'`).
	await postMessage(req, {
		author: { system: 'import' },
		channel: 'internal',
		data: { text: 'Birth date inferred from the club CSV import (only the year was given).' },
		instance: 'comments',
		key,
		type: 'system.note',
	})
	for (const [author, text] of [
		[`customers:${customer.id}`, 'We uploaded the new medical form, can you check?'],
		[`users:${anna.id}`, 'Thanks, it looks good. Please also send a full-page passport scan.'],
	] as const) {
		await postMessage(req, { author, channel: 'shared', instance: 'comments', key, text })
	}
}

type ChatLine = {
	/** Minutes before now. */
	ago: number
	author: 'anna' | 'marc' | 'me'
	replies?: Array<Omit<ChatLine, 'replies'>>
	text: string
}

/** `readTo`: minutes ago the dev user last read the room; `null` never, absent all read. */
const ROOMS: Array<{
	archived?: boolean
	lines: ChatLine[]
	name: string
	readTo?: null | number
	topic: string
}> = [
	{
		lines: [
			{
				ago: 2 * 1440 + 300,
				author: 'anna',
				text: 'Morning all! Heat sheets for the spring cup are in the shared folder.',
			},
			{
				ago: 2 * 1440 + 297,
				author: 'anna',
				text: 'Please flag anything that looks off before Thursday.',
			},
			{ ago: 2 * 1440 + 240, author: 'marc', text: 'Looking now.' },
			{
				ago: 1440 + 420,
				author: 'me',
				replies: [
					{ ago: 1440 + 400, author: 'anna', text: 'Yes, 14:00 in the small room.' },
					{ ago: 1440 + 390, author: 'marc', text: 'I will join remotely.' },
				],
				text: 'Are we still on for the review call tomorrow?',
			},
			{
				ago: 1440 + 120,
				author: 'marc',
				text: 'Uploaded the new start lists. The K1 women 500 m had a duplicate entry, removed it.',
			},
			{
				ago: 180,
				author: 'anna',
				text: 'Federation confirmed the medical forms are fine this season.',
			},
			{ ago: 176, author: 'anna', text: 'So we only need passports from the new athletes.' },
			{ ago: 40, author: 'me', text: 'Great, I will update the checklist.' },
			{
				ago: 6,
				author: 'marc',
				text: 'Photographer asked about the finish line position, who knows?',
			},
		],
		name: 'general',
		readTo: 100,
		topic: 'Everything about the spring cup',
	},
	{
		lines: [
			{ ago: 3 * 1440, author: 'anna', text: 'New poster draft is up, feedback welcome.' },
			{
				ago: 3 * 1440 - 30,
				author: 'me',
				text: 'Love the colours. The date is hard to read on mobile though.',
			},
			{ ago: 200, author: 'anna', text: 'Fixed the date size, v3 is up.' },
		],
		name: 'design',
		topic: 'Posters, social tiles, the website',
	},
	{
		lines: [
			{ ago: 5 * 1440, author: 'marc', text: 'Results page is live on staging.' },
			{ ago: 90, author: 'marc', text: 'Deploying the timing integration tonight at 22:00.' },
		],
		name: 'releases',
		readTo: null,
		topic: 'What ships and when',
	},
	{
		archived: true,
		lines: [
			{ ago: 90 * 1440, author: 'anna', text: 'Final results are published, thanks everyone!' },
			{ ago: 90 * 1440 - 10, author: 'marc', text: 'Archiving this room, see you in spring.' },
		],
		name: 'winter-cup',
		topic: 'Last season, archived: read only',
	},
]

/**
 * Seed the `chat` instance: four rooms (one archived, so read only) with a
 * few days of history and a thread. Dates are moved back after posting, since
 * messages are stamped when they are created. Idempotent.
 */
export const seedChat = async (
	payload: Payload,
	{ anna, marc, me }: { anna: string; marc: string; me: string }
): Promise<void> => {
	if ((await payload.count({ collection: 'rooms' })).totalDocs > 0) return
	const authors = { anna: `users:${anna}`, marc: `users:${marc}`, me: `users:${me}` }
	const req = await createLocalReq({}, payload)
	const collection = 'chat-messages'
	const at = (ago: number) => new Date(Date.now() - ago * 60_000).toISOString()
	const backdate = (id: number | string, data: Record<string, unknown>) =>
		payload.db.updateOne({ collection, data, id, req, returning: false })

	for (const room of ROOMS) {
		const doc = await payload.create({
			collection: 'rooms',
			data: { archived: room.archived ?? false, name: room.name, topic: room.topic },
		})
		const key = `collection:rooms:${doc.id}`
		for (const line of room.lines) {
			const root = await postMessage(req, {
				author: authors[line.author],
				channel: 'messages',
				instance: 'chat',
				key,
				text: line.text,
			})
			for (const reply of line.replies ?? []) {
				const message = await postMessage(req, {
					author: authors[reply.author],
					channel: 'messages',
					instance: 'chat',
					key,
					parent: String(root.id),
					text: reply.text,
				})
				await backdate(message.id, { createdAt: at(reply.ago), updatedAt: at(reply.ago) })
			}
			const lastReply = line.replies?.at(-1)
			await backdate(root.id, {
				createdAt: at(line.ago),
				updatedAt: at(lastReply?.ago ?? line.ago),
				...(lastReply ? { lastReplyAt: at(lastReply.ago) } : {}),
			})
		}
		// Own posts raised the dev user's cursor to now; set it back so some rooms show unread.
		if (room.readTo !== undefined) {
			const reads = 'chat-reads'
			const where: Where = { and: [{ key: { equals: key } }, { userKey: { equals: authors.me } }] }
			await payload.db.deleteMany({ collection: reads, req, where })
			if (room.readTo !== null) {
				await payload.db.create({
					collection: reads,
					data: {
						channel: 'messages',
						key,
						lastReadAt: at(room.readTo),
						thread: '',
						userKey: authors.me,
					},
					req,
					returning: false,
				})
			}
		}
	}
}

/**
 * Seed the `tickets` instance: an open ticket with a short exchange and a
 * staff note, and a closed one (read only). Idempotent.
 */
export const seedTickets = async (
	payload: Payload,
	{ anna, customer, me }: { anna: string; customer: string; me: string }
): Promise<void> => {
	if ((await payload.count({ collection: 'tickets' })).totalDocs > 0) return
	const req = await createLocalReq({}, payload)
	const open = await payload.create({
		collection: 'tickets',
		data: { customer, status: 'open', subject: 'Medical form upload fails' },
	})
	const closed = await payload.create({
		collection: 'tickets',
		data: { customer, status: 'closed', subject: 'Invoice for March' },
	})
	const openKey = `collection:tickets:${open.id}`
	const closedKey = `collection:tickets:${closed.id}`
	const lines: Array<[key: string, author: string, channel: string, text: string]> = [
		[openKey, `customers:${customer}`, 'conversation', 'The upload stops at 90 %, twice now.'],
		[openKey, `users:${anna}`, 'conversation', 'Sorry about that! Which browser are you using?'],
		[openKey, `users:${anna}`, 'notes', 'Probably the 10 MB limit again, checking the logs.'],
		[closedKey, `customers:${customer}`, 'conversation', 'Could you resend the March invoice?'],
		[closedKey, `users:${me}`, 'conversation', 'Sent again, closing this one.'],
	]
	for (const [key, author, channel, text] of lines) {
		await postMessage(req, { author, channel, instance: 'tickets', key, text })
	}
}

/** Seed the `notes` instance: one project with a short exchange and a thread. Idempotent. */
export const seedProjects = async (
	payload: Payload,
	{ anna, me }: { anna: string; me: string }
): Promise<void> => {
	if ((await payload.count({ collection: 'projects' })).totalDocs > 0) return
	const req = await createLocalReq({}, payload)
	const project = await payload.create({
		collection: 'projects',
		data: { name: 'Website relaunch' },
	})
	const key = `collection:projects:${project.id}`
	const root = await postMessage(req, {
		author: `users:${anna}`,
		channel: 'team',
		instance: 'notes',
		key,
		text: 'Kick-off is on Monday, agenda below.',
	})
	await postMessage(req, {
		author: `users:${me}`,
		channel: 'team',
		instance: 'notes',
		key,
		parent: String(root.id),
		text: 'I will bring the sitemap draft.',
	})
	await postMessage(req, {
		author: `users:${me}`,
		channel: 'log',
		instance: 'notes',
		key,
		text: 'Decided: launch without the blog.',
	})
}
