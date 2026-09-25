import type {
	ListResponse,
	MentionsResponse,
	PollResponse,
	SubscribeResponse,
	WireMessage,
} from '@10x-media/conversations/react'
import type { AuthorsMap } from '@10x-media/conversations/types'

/**
 * An in-memory stand-in for the `comments` instance endpoints, so the
 * playground can show states the seeded dev data never reaches (slow and
 * failing requests, a read-only channel, a hundred unread) without touching
 * the database. `ChatProvider` takes it through its `fetch` prop; everything
 * above the fetch (store, poller, hooks, components) is the real code.
 */

export const ME = 'users:me'
export const ANNA = 'users:anna'
export const MARC = 'users:marc'
export const GONE = 'users:gone'
export const CUSTOMER = 'customers:czech-canoe'

const avatar = `data:image/svg+xml;utf8,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6d8cff"/><stop offset="1" stop-color="#b86dff"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="32" cy="26" r="11" fill="#fff" opacity=".85"/><rect x="14" y="41" width="36" height="20" rx="10" fill="#fff" opacity=".85"/></svg>'
)}`

export const AUTHORS: AuthorsMap = {
	[ANNA]: { name: 'Anna Keller' },
	[CUSTOMER]: { name: 'Czech Canoe' },
	[GONE]: { deleted: true, name: 'Deleted user' },
	[MARC]: { avatar, name: 'Marc Oliveira' },
	[ME]: { name: 'Roman Palamar' },
}

/** Conversation keys the mock serves. `custom:` keys, so they never collide with real targets. */
export const MOCK_KEYS = {
	busy: 'custom:playground:busy',
	empty: 'custom:playground:empty',
	gallery: 'custom:playground:gallery',
	many: 'custom:playground:many',
	readonly: 'custom:playground:readonly',
	sandbox: 'custom:playground:sandbox',
} as const

/** A client-side message type the mock uses; the real instance does not register it. */
export const NOTE_TYPE = 'playground.note'

const CHANNEL_META: SubscribeResponse['channels'] = {
	announcements: { label: 'Announcements' },
	internal: { cue: { label: 'Internal · staff only', tone: 'neutral' }, label: 'Internal' },
	shared: { cue: { label: 'Shared · visible to the customer', tone: 'warning' }, label: 'Shared' },
}

type LexicalNode = Record<string, unknown>

export const lexical = {
	doc: (...blocks: LexicalNode[]) => ({
		root: { children: blocks, direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 },
	}),
	link: (url: string, label: string): LexicalNode => ({
		children: [lexical.text(label)],
		direction: 'ltr',
		fields: { linkType: 'custom', newTab: true, url },
		format: '',
		indent: 0,
		type: 'link',
		version: 3,
	}),
	list: (tag: 'ol' | 'ul', items: LexicalNode[][]): LexicalNode => ({
		children: items.map((children, index) => ({
			children,
			direction: 'ltr',
			format: '',
			indent: 0,
			type: 'listitem',
			value: index + 1,
			version: 1,
		})),
		direction: 'ltr',
		format: '',
		indent: 0,
		listType: tag === 'ul' ? 'bullet' : 'number',
		start: 1,
		tag,
		type: 'list',
		version: 1,
	}),
	mention: (userKey: string): LexicalNode => ({
		label: AUTHORS[userKey]?.name ?? userKey,
		type: 'conversationsMention',
		userKey,
		version: 1,
	}),
	paragraph: (...children: LexicalNode[]): LexicalNode => ({
		children,
		direction: 'ltr',
		format: '',
		indent: 0,
		textFormat: 0,
		type: 'paragraph',
		version: 1,
	}),
	/** `format` is Lexical's bit mask: 1 bold, 2 italic, 16 code. */
	text: (text: string, format = 0): LexicalNode => ({
		detail: 0,
		format,
		mode: 'normal',
		style: '',
		text,
		type: 'text',
		version: 1,
	}),
}

const plainText = (body: unknown): string => {
	const parts: string[] = []
	const walk = (node: unknown) => {
		if (!node || typeof node !== 'object') return
		const record = node as { children?: unknown[]; label?: string; text?: string; type?: string }
		if (typeof record.text === 'string') parts.push(record.text)
		if (record.type === 'conversationsMention') parts.push(`@${record.label ?? ''}`)
		for (const child of record.children ?? []) walk(child)
		if (record.type === 'paragraph' || record.type === 'listitem') parts.push('\n')
	}
	walk((body as { root?: unknown } | null)?.root)
	return parts.join('').trim()
}

const LINES = [
	'The federation sent the passport scan, the club confirmation and the medical form in one email.',
	'I split them into separate uploads so each one can be reviewed.',
	'Medical form is from last season, we need the current one.',
	'Asked the club for a new one, they said end of the week.',
	'Heat times need a final check before we publish.',
	'Photo is missing too, I asked the partner for one.',
	'Title fixed.',
	'Can someone double check the date of birth? It differs from the licence.',
	'On it.',
	'Done, uploaded the corrected version.',
]

type Seed = {
	at: Date
	author: string
	body?: unknown
	channel?: string
	data?: unknown
	deleted?: boolean
	editedAt?: Date
	/** Name for `pick()`, to find this message after build. */
	name?: string
	replies?: Array<{ at: Date; author: string; text: string }>
	text?: string
	type?: string
}

type Conversation = {
	channels: Array<{ canCreate: boolean; slug: string }>
	/** Read cursor per channel; `null` means never read. */
	cursors: Record<string, null | string>
	messages: WireMessage[]
	threadCursors: Record<string, string>
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

const dayAt = (daysAgo: number, hour: number, minute: number) => {
	const date = new Date()
	date.setDate(date.getDate() - daysAgo)
	date.setHours(hour, minute, 0, 0)
	return date
}

/** Runs of one author, so grouping (compact follow-ups) shows up. */
const RUNS: Array<[string, number]> = [
	[ANNA, 3],
	[ME, 1],
	[MARC, 2],
	[ANNA, 1],
	[ME, 2],
	[MARC, 1],
]

const history = (start: Date, count: number, offset = 0): Seed[] => {
	const seeds: Seed[] = []
	let time = start.getTime()
	let run = 0
	let left = RUNS[0]?.[1] ?? 1
	for (let index = 0; index < count; index++) {
		const [author] = RUNS[run % RUNS.length] as [string, number]
		seeds.push({ at: new Date(time), author, text: LINES[(index + offset) % LINES.length] })
		left--
		if (left === 0) {
			run++
			left = RUNS[run % RUNS.length]?.[1] ?? 1
			time += (18 + ((index * 7) % 25)) * 60_000
		} else {
			time += 60_000 + ((index * 13) % 50) * 1000
		}
	}
	return seeds
}

export type MockKnobs = {
	/** Fail `GET /messages`: the feed's error state. */
	failLoads: boolean
	/** Fail `POST /messages`: the composer's retry banner. */
	failSends: boolean
	/** Added to every request, in ms. */
	latency: number
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status })

const fail = (message: string, status: number) => json({ errors: [{ message }] }, status)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const time = (value: string) => new Date(value).getTime()

const byTime = (a: WireMessage, b: WireMessage) =>
	time(a.createdAt) - time(b.createdAt) || Number(a.id) - Number(b.id)

const isRemoved = (message: WireMessage) =>
	Boolean(message.deletedAt) && (Boolean(message.parent) || !(message.replyCount ?? 0))

export class MockServer {
	knobs: MockKnobs = { failLoads: false, failSends: false, latency: 250 }
	private conversations = new Map<string, Conversation>()
	private changed = new Set<string>()
	private named = new Map<string, WireMessage>()
	private nextId = 1

	constructor() {
		this.reset()
	}

	/** Rebuild every fixture conversation from scratch. */
	reset(): void {
		this.conversations.clear()
		this.changed.clear()
		this.named.clear()
		this.nextId = 1
		this.buildBusy()
		this.buildGallery()
		this.build(MOCK_KEYS.empty, { channels: ['internal', 'shared'], seeds: [] })
		this.build(MOCK_KEYS.readonly, {
			channels: [{ canCreate: false, slug: 'announcements' }],
			seeds: [
				{
					at: dayAt(3, 9, 0),
					author: ANNA,
					channel: 'announcements',
					text: 'Entries close on Friday.',
				},
				{
					at: dayAt(1, 14, 30),
					author: ANNA,
					channel: 'announcements',
					text: 'Heat times are published.',
				},
				{
					at: minutesAgo(40),
					author: MARC,
					channel: 'announcements',
					text: 'Start lists are final.',
				},
			],
		})
		const many = history(dayAt(4, 8, 0), 150)
		this.build(MOCK_KEYS.many, {
			channels: ['internal', 'shared'],
			cursors: { internal: many[19]?.at.toISOString() ?? null, shared: null },
			seeds: many,
		})
		this.build(MOCK_KEYS.sandbox, {
			channels: ['internal', 'shared'],
			seeds: [
				{
					at: minutesAgo(12),
					author: ANNA,
					text: 'Try the composer here, sends stay in the browser.',
				},
			],
		})
	}

	/** A message built by the fixtures, by its fixture name. */
	pick(name: string): WireMessage | undefined {
		return this.named.get(name)
	}

	/** Someone else posts: shows up through the real poller on its next tick. */
	incoming({
		author = ANNA,
		channel = 'internal',
		key,
		parent,
		text,
	}: {
		author?: string
		channel?: string
		key: string
		parent?: string
		text?: string
	}): void {
		const conversation = this.conversations.get(key)
		if (!conversation) return
		const root = parent ? conversation.messages.find((m) => String(m.id) === parent) : undefined
		const at = new Date()
		const message = this.create(key, {
			at,
			author,
			channel: root?.channel ?? channel,
			text: text ?? LINES[Math.floor(Math.random() * LINES.length)],
		})
		if (root) {
			message.parent = String(root.id)
			root.replyCount = (root.replyCount ?? 0) + 1
			root.lastReplyAt = at.toISOString()
			root.updatedAt = at.toISOString()
		}
		conversation.messages.push(message)
		this.changed.add(key)
	}

	fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
		if (this.knobs.latency > 0) await sleep(this.knobs.latency)
		const url = new URL(input, 'http://mock')
		const path = url.pathname.replace(/^.*\/conversations\/[^/]+/, '')
		const method = (init.method ?? 'GET').toUpperCase()
		const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
		if (path === '/subscribe') return this.subscribe(body.keys as string[])
		if (path === '/poll') return this.poll(body.tokens as string[])
		if (path === '/read') return this.read(body)
		if (path === '/mentions') return this.mentions(url.searchParams.get('q') ?? '')
		if (path === '/messages' && method === 'GET') return this.list(url.searchParams)
		if (path === '/messages' && method === 'POST') return this.send(body)
		const id = /^\/messages\/(.+)$/.exec(path)?.[1]
		if (id && method === 'PATCH') return this.edit(decodeURIComponent(id), body)
		if (id && method === 'DELETE') return this.remove(decodeURIComponent(id))
		return fail(`Mock has no ${method} ${path}`, 404)
	}

	private create(key: string, seed: Seed): WireMessage {
		const id = this.nextId++
		const at = seed.at.toISOString()
		const body =
			seed.body ?? (seed.text ? lexical.doc(lexical.paragraph(lexical.text(seed.text))) : undefined)
		const message: WireMessage = {
			authorKey: seed.author,
			body: seed.type ? undefined : body,
			channel: seed.channel ?? 'internal',
			clientId: null,
			createdAt: at,
			data: seed.data,
			deletedAt: null,
			editedAt: seed.editedAt?.toISOString() ?? null,
			id,
			key,
			lastReplyAt: null,
			mentions: [],
			parent: null,
			replyCount: 0,
			text: seed.type ? null : plainText(body),
			type: seed.type ?? 'text',
			updatedAt: seed.editedAt?.toISOString() ?? at,
		}
		if (seed.name) this.named.set(seed.name, message)
		return message
	}

	private build(
		key: string,
		{
			channels,
			cursors = {},
			seeds,
		}: {
			channels: Array<string | { canCreate: boolean; slug: string }>
			/** Read cursor per channel; omitted means never read. */
			cursors?: Record<string, null | string>
			seeds: Seed[]
		}
	): Conversation {
		const conversation: Conversation = {
			channels: channels.map((channel) =>
				typeof channel === 'string' ? { canCreate: true, slug: channel } : channel
			),
			cursors,
			messages: [],
			threadCursors: {},
		}
		for (const seed of [...seeds].sort((a, b) => a.at.getTime() - b.at.getTime())) {
			const root = this.create(key, seed)
			conversation.messages.push(root)
			for (const reply of seed.replies ?? []) {
				const message = this.create(key, { ...reply, channel: root.channel })
				message.parent = String(root.id)
				conversation.messages.push(message)
				root.replyCount = (root.replyCount ?? 0) + 1
				root.lastReplyAt = message.createdAt
			}
			if (seed.deleted) {
				root.deletedAt = minutesAgo(1).toISOString()
				root.body = null
				root.text = null
			}
		}
		this.conversations.set(key, conversation)
		return conversation
	}

	private buildBusy(): void {
		const seeds: Seed[] = [
			...history(dayAt(2, 9, 10), 24),
			...history(dayAt(1, 10, 5), 22, 3),
			{
				at: minutesAgo(95),
				author: ANNA,
				body: lexical.doc(
					lexical.paragraph(
						lexical.text('Checklist for '),
						lexical.text('Jana', 1),
						lexical.text(' before we publish, see '),
						lexical.link('https://example.com/entries/2026', 'the entry form')
					),
					lexical.list('ul', [
						[lexical.text('Passport scan, full page')],
						[lexical.text('Medical form, '), lexical.text('current season', 2)],
						[lexical.text('Photo')],
					])
				),
			},
			{
				at: minutesAgo(90),
				author: MARC,
				text: 'The partner portal link is https://partners.example.com/federations/czech-canoe/athletes/2026/uploads?token=a8f3c2e9d1b7a6f5e4d3c2b1a0987654321 and it expires tonight. Supercalifragilisticexpialidocious-sized words should wrap too.',
			},
			{
				at: minutesAgo(80),
				author: ME,
				name: 'own',
				text: 'My own message: hover it for Edit and Delete.',
			},
			{
				at: minutesAgo(70),
				author: ANNA,
				name: 'threadNew',
				replies: [
					{ at: minutesAgo(60), author: ME, text: 'Licence says 14 March.' },
					{ at: minutesAgo(50), author: MARC, text: 'Passport too, so the form is wrong.' },
					{ at: minutesAgo(12), author: ANNA, text: 'Fixed the form, thanks both.' },
				],
				text: 'Which date of birth is right, the licence or the form?',
			},
			{ at: minutesAgo(65), author: GONE, text: 'A message from a user who no longer exists.' },
			{
				at: minutesAgo(55),
				author: ME,
				name: 'threadRead',
				replies: [{ at: minutesAgo(45), author: MARC, text: 'Yes, sent it this morning.' }],
				text: 'Did the club confirm the heat?',
			},
			{
				at: minutesAgo(40),
				author: MARC,
				deleted: true,
				name: 'deletedRoot',
				replies: [
					{ at: minutesAgo(38), author: ANNA, text: 'Replying to something that is gone now.' },
					{ at: minutesAgo(36), author: ME, text: 'The thread survives the delete.' },
				],
				text: 'Deleted',
			},
			{
				at: minutesAgo(30),
				author: ANNA,
				editedAt: minutesAgo(26),
				text: 'Heat 3 starts at 10:40, not 10:30 (edited).',
			},
			{
				at: minutesAgo(20),
				author: ME,
				data: { from: 'draft', to: 'in review' },
				type: NOTE_TYPE,
			},
			{
				at: minutesAgo(15),
				author: ANNA,
				body: lexical.doc(
					lexical.paragraph(
						lexical.text('Heads up '),
						lexical.mention(ME),
						lexical.text(', the English intro still says "Ereasmus".')
					)
				),
			},
			{ at: minutesAgo(10), author: MARC, text: 'Uploading the photo now.' },
			{
				at: minutesAgo(9),
				author: MARC,
				text: 'Done. Follow-ups within five minutes group under one header.',
			},
			{ at: minutesAgo(3), author: ANNA, text: 'Great, ready for review then.' },
			{
				at: dayAt(3, 16, 20),
				author: CUSTOMER,
				channel: 'shared',
				text: 'We uploaded the new medical form, can you check?',
			},
			{
				at: dayAt(2, 8, 45),
				author: ANNA,
				channel: 'shared',
				text: 'Thanks, it looks good. Please also send a full-page passport scan.',
			},
			{
				at: minutesAgo(25),
				author: CUSTOMER,
				channel: 'shared',
				text: 'Passport scan attached to the person now.',
			},
		]
		const conversation = this.build(MOCK_KEYS.busy, {
			channels: ['internal', 'shared'],
			cursors: {
				internal: minutesAgo(32).toISOString(),
				shared: dayAt(2, 9, 0).toISOString(),
			},
			seeds,
		})
		const threadNew = this.pick('threadNew')
		const threadRead = this.pick('threadRead')
		if (threadNew) conversation.threadCursors[String(threadNew.id)] = minutesAgo(48).toISOString()
		if (threadRead) conversation.threadCursors[String(threadRead.id)] = minutesAgo(44).toISOString()
	}

	/** One message per state, for the gallery. Real rows, so Edit and Delete answer. */
	private buildGallery(): void {
		const seeds: Seed[] = [
			{
				at: minutesAgo(300),
				author: ANNA,
				name: 'g:plain',
				text: 'A plain message from someone else.',
			},
			{
				at: minutesAgo(290),
				author: ME,
				name: 'g:own',
				text: 'My own message, with Edit and Delete on hover.',
			},
			{
				at: minutesAgo(280),
				author: MARC,
				editedAt: minutesAgo(270),
				name: 'g:edited',
				text: 'An edited message, with an avatar image.',
			},
			{
				at: minutesAgo(260),
				author: ANNA,
				body: lexical.doc(
					lexical.paragraph(
						lexical.text('Rich text: '),
						lexical.text('bold', 1),
						lexical.text(', '),
						lexical.text('italic', 2),
						lexical.text(', '),
						lexical.link('https://payloadcms.com', 'a link'),
						lexical.text(' and a mention of '),
						lexical.mention(MARC)
					),
					lexical.list('ol', [[lexical.text('First')], [lexical.text('Second')]]),
					lexical.paragraph(lexical.text('A second paragraph.'))
				),
				name: 'g:rich',
			},
			{
				at: minutesAgo(250),
				author: MARC,
				name: 'g:long',
				text:
					'A long one. '.repeat(30) +
					'https://example.com/a/very/long/url/without/any/breaks/that/must/wrap/somewhere/in/the/message/body',
			},
			{
				at: minutesAgo(240),
				author: ANNA,
				name: 'g:threadNew',
				replies: [
					{ at: minutesAgo(230), author: ME, text: 'One' },
					{ at: minutesAgo(20), author: MARC, text: 'Two' },
				],
				text: 'A thread with new replies.',
			},
			{
				at: minutesAgo(200),
				author: ME,
				name: 'g:threadRead',
				replies: [{ at: minutesAgo(190), author: ANNA, text: 'Only reply' }],
				text: 'A thread with one reply, read.',
			},
			{
				at: minutesAgo(180),
				author: MARC,
				deleted: true,
				name: 'g:deleted',
				replies: [{ at: minutesAgo(170), author: ANNA, text: 'Reply under a deleted root' }],
				text: 'x',
			},
			{ at: minutesAgo(160), author: GONE, name: 'g:gone', text: 'Written by a deleted user.' },
			{
				at: minutesAgo(150),
				author: CUSTOMER,
				channel: 'shared',
				name: 'g:customer',
				text: 'From a customer account (second users collection).',
			},
			{
				at: minutesAgo(140),
				author: ME,
				data: { from: 'draft', to: 'published' },
				name: 'g:note',
				type: NOTE_TYPE,
			},
			{ at: minutesAgo(130), author: ANNA, data: {}, name: 'g:unknown', type: 'unregistered.type' },
		]
		const conversation = this.build(MOCK_KEYS.gallery, {
			channels: ['internal', 'shared'],
			cursors: { internal: minutesAgo(1000).toISOString(), shared: null },
			seeds,
		})
		const read = this.pick('g:threadRead')
		if (read) conversation.threadCursors[String(read.id)] = minutesAgo(100).toISOString()
	}

	private visibleRoots(conversation: Conversation, channel: string) {
		return conversation.messages.filter(
			(message) => message.channel === channel && !message.parent && !isRemoved(message)
		)
	}

	private subscribe(keys: string[]): Response {
		const entries: SubscribeResponse['entries'] = []
		for (const key of keys) {
			const conversation = this.conversations.get(key)
			if (!conversation) continue
			const unread: Record<string, number> = {}
			let count = 0
			for (const { slug } of conversation.channels) {
				const roots = this.visibleRoots(conversation, slug)
				count += roots.length
				const cursor = conversation.cursors[slug]
				unread[slug] = roots.filter(
					(message) =>
						!message.deletedAt &&
						message.authorKey !== ME &&
						(!cursor || time(message.createdAt) > time(cursor))
				).length
			}
			entries.push({ channels: conversation.channels, count, key, token: key, unread })
		}
		const response: SubscribeResponse = {
			channels: CHANNEL_META,
			deleted: 'placeholderIfReplies',
			entries,
			extensionData: {},
			extensions: ['comments'],
			now: new Date().toISOString(),
			reads: true,
			viewer: ME,
		}
		return json(response)
	}

	private poll(tokens: string[]): Response {
		const changed = tokens.filter((key) => this.changed.has(key))
		for (const key of changed) this.changed.delete(key)
		const response: PollResponse = { changed, expired: [], now: new Date().toISOString() }
		return json(response)
	}

	private read(body: Record<string, unknown>): Response {
		const conversation = this.conversations.get(String(body.key))
		const at = String(body.at)
		if (conversation) {
			const raise = (current: null | string | undefined) =>
				!current || time(at) > time(current) ? at : current
			if (typeof body.thread === 'string') {
				conversation.threadCursors[body.thread] = raise(conversation.threadCursors[body.thread])
			} else {
				for (const channel of (body.channels as string[] | undefined) ?? []) {
					conversation.cursors[channel] = raise(conversation.cursors[channel])
				}
			}
		}
		return json({ ok: true })
	}

	private mentions(q: string): Response {
		const query = q.toLowerCase()
		const users = Object.entries(AUTHORS)
			.filter(([, author]) => !author.deleted && author.name.toLowerCase().includes(query))
			.map(([userKey, author]) => ({ ...author, userKey }))
		const response: MentionsResponse = { users }
		return json(response)
	}

	private list(params: URLSearchParams): Response {
		if (this.knobs.failLoads) return fail('Mock: loads are set to fail', 500)
		const conversation = this.conversations.get(params.get('key') ?? '')
		if (!conversation) return fail('Not found', 404)
		const channels = (params.get('channel') ?? '').split(',').filter(Boolean)
		const parent = params.get('parent')
		const limit = Number(params.get('limit') ?? 30)
		const inScope = conversation.messages
			.filter(
				(message) =>
					(parent ? message.parent === parent : !message.parent) &&
					(parent ? true : channels.includes(message.channel))
			)
			.sort(byTime)
		const threadReads = (messages: WireMessage[]) =>
			Object.fromEntries(
				messages
					.map((message) => [String(message.id), conversation.threadCursors[String(message.id)]])
					.filter(([, at]) => Boolean(at))
			) as Record<string, string>
		const respond = (messages: WireMessage[], extra: Partial<ListResponse>) => {
			const response: ListResponse = {
				authors: AUTHORS,
				hasNewer: false,
				hasOlder: false,
				messages,
				threadReads: threadReads(messages),
				...extra,
			}
			return json(response)
		}

		const updatedSince = params.get('updatedSince')
		if (updatedSince) {
			return respond(
				inScope
					.filter((message) => time(message.updatedAt) > time(updatedSince))
					.map((message) => (isRemoved(message) ? { ...message, removed: true } : message)),
				{}
			)
		}

		const rows = inScope.filter((message) => !isRemoved(message))
		const position = (cursor: string) => {
			const [at, id] = cursor.split(',')
			return (message: WireMessage) =>
				time(message.createdAt) - time(at ?? '') || Number(message.id) - Number(id)
		}
		const before = params.get('before')
		if (before) {
			const older = rows.filter((message) => position(before)(message) < 0)
			return respond(older.slice(-limit), { hasOlder: older.length > limit })
		}
		const after = params.get('after')
		if (after) {
			const newer = rows.filter((message) => position(after)(message) > 0)
			return respond(newer.slice(0, limit), { hasNewer: newer.length > limit })
		}

		let cursor: null | string
		if (parent) {
			cursor = conversation.threadCursors[parent] ?? null
		} else {
			const each = channels.map((channel) => conversation.cursors[channel] ?? null)
			cursor = each.every(Boolean) ? ([...(each as string[])].sort()[0] ?? null) : null
		}
		if (!params.get('latest') && cursor) {
			const first = rows.findIndex(
				(message) => message.authorKey !== ME && time(message.createdAt) > time(cursor as string)
			)
			const unread = first === -1 ? 0 : rows.length - first
			if (unread > limit) {
				const start = Math.max(0, first - 5)
				const end = start + limit
				return respond(rows.slice(start, end), {
					cursor,
					hasNewer: end < rows.length,
					hasOlder: start > 0,
				})
			}
		}
		return respond(rows.slice(-limit), { cursor, hasOlder: rows.length > limit })
	}

	private send(body: Record<string, unknown>): Response {
		if (this.knobs.failSends) return fail('Mock: sends are set to fail', 500)
		const key = String(body.key)
		const conversation = this.conversations.get(key)
		if (!conversation) return fail('Not found', 404)
		const existing = conversation.messages.find((message) => message.clientId === body.clientId)
		if (existing) return json({ authors: AUTHORS, message: existing })
		const parent = typeof body.parent === 'string' ? body.parent : null
		const root = parent
			? conversation.messages.find((message) => String(message.id) === parent)
			: undefined
		const at = new Date()
		const message = this.create(key, {
			at,
			author: ME,
			body: body.body,
			channel: root?.channel ?? String(body.channel),
			text: typeof body.text === 'string' ? body.text : undefined,
		})
		message.clientId = String(body.clientId)
		if (root) {
			message.parent = String(root.id)
			root.replyCount = (root.replyCount ?? 0) + 1
			root.lastReplyAt = message.createdAt
			root.updatedAt = message.createdAt
			conversation.threadCursors[String(root.id)] = message.createdAt
		} else {
			conversation.cursors[message.channel] = message.createdAt
		}
		conversation.messages.push(message)
		return json({ authors: AUTHORS, message })
	}

	private find(id: string) {
		for (const conversation of this.conversations.values()) {
			const message = conversation.messages.find((row) => String(row.id) === id)
			if (message) return { conversation, message }
		}
		return null
	}

	private edit(id: string, body: Record<string, unknown>): Response {
		const found = this.find(id)
		if (!found) return fail('Not found', 404)
		const now = new Date().toISOString()
		found.message.body = body.body
		found.message.text = plainText(body.body)
		found.message.editedAt = now
		found.message.updatedAt = now
		return json({ authors: AUTHORS, message: found.message })
	}

	private remove(id: string): Response {
		const found = this.find(id)
		if (!found) return fail('Not found', 404)
		const { conversation, message } = found
		const now = new Date().toISOString()
		message.body = null
		message.text = null
		message.data = null
		message.deletedAt = now
		message.updatedAt = now
		if (message.parent) {
			const root = conversation.messages.find((row) => String(row.id) === message.parent)
			if (root) {
				root.replyCount = Math.max(0, (root.replyCount ?? 1) - 1)
				root.updatedAt = now
			}
		}
		return json({ message: isRemoved(message) ? { ...message, removed: true } : message })
	}
}

/** One server for the page, so knobs and data survive switching stories. */
export const mockServer = new MockServer()
