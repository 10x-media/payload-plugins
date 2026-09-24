import { createLocalReq, type Payload } from 'payload'

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
	{ collection, email, name }: { collection: 'customers' | 'users'; email: string; name: string }
) => {
	const found = await payload.find({ collection, limit: 1, where: { email: { equals: email } } })
	if (found.docs[0]) return found.docs[0]
	return payload.create({ collection, data: { email, name, password: DEV_PASSWORD } })
}

/**
 * Seed the dev app: two staff users (log in as the first), a customer, two
 * persons, and one conversation long enough to page through (130 messages,
 * a thread, a mention). Idempotent.
 */
export const seedDev = async (payload: Payload): Promise<void> => {
	const me = await ensureUser(payload, {
		collection: 'users',
		email: DEV_EMAIL,
		name: 'Roman Palamar',
	})
	const anna = await ensureUser(payload, {
		collection: 'users',
		email: 'anna@10xmedia.de',
		name: 'Anna Keller',
	})
	const customer = await ensureUser(payload, {
		collection: 'customers',
		email: 'customer@example.com',
		name: 'Czech Canoe',
	})

	if ((await payload.count({ collection: 'persons' })).totalDocs > 0) return
	payload.logger.info(`Seeded dev admin: ${DEV_EMAIL} / ${DEV_PASSWORD}`)

	const athlete = await payload.create({
		collection: 'persons',
		data: { name: 'Jana Nováková', owner: customer.id },
	})
	await payload.create({ collection: 'persons', data: { name: 'Tomás Ruiz' } })
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
	for (const [author, text] of [
		[`customers:${customer.id}`, 'We uploaded the new medical form, can you check?'],
		[`users:${anna.id}`, 'Thanks, it looks good. Please also send a full-page passport scan.'],
	] as const) {
		await postMessage(req, { author, channel: 'shared', instance: 'comments', key, text })
	}
}
