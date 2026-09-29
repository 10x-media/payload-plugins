import { type BootedPayload, bootPayload, type SupportedDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, type GlobalConfig, handleEndpoints, type Plugin } from 'payload'

import { conversations, perTarget } from '../../src/index'
import { parseEvents } from '../../src/react/sse'
import type { ConversationsChannel, ConversationsPluginOptions } from '../../src/types'

export const collections: CollectionConfig[] = [
	{
		admin: { useAsTitle: 'name' },
		auth: true,
		fields: [{ name: 'name', type: 'text' }],
		slug: 'users',
	},
	{
		admin: { useAsTitle: 'name' },
		auth: true,
		fields: [{ name: 'name', type: 'text' }],
		slug: 'customers',
	},
	{
		access: { read: () => true },
		admin: { useAsTitle: 'name' },
		fields: [
			{ name: 'name', type: 'text' },
			{ name: 'owner', type: 'text' },
		],
		slug: 'persons',
	},
	{ fields: [{ name: 'title', type: 'text' }], slug: 'media' },
]

/** A global target; staff pass the fixture's access, customers never (no owner). */
export const globals: GlobalConfig[] = [
	{ fields: [{ name: 'motto', type: 'text' }], slug: 'settings' },
]

const isStaff = (req: { user?: { collection?: string } | null }) => req.user?.collection === 'users'

export const channels: ConversationsChannel[] = [
	{
		access: { create: ({ req }) => isStaff(req), read: ({ req }) => isStaff(req) },
		label: 'Internal',
		slug: 'internal',
	},
	{
		access: { create: () => true, read: () => true },
		cue: { label: 'Visible to customers', tone: 'warning' },
		label: 'Shared',
		slug: 'shared',
	},
]

/** Staff see every person; a customer only the persons whose `owner` is them. */
export const access = perTarget(
	({ doc, req }) =>
		isStaff(req) || (doc?.owner !== undefined && doc.owner === String(req.user?.id)),
	{ load: true }
)

export const instanceOptions = (
	overrides: Partial<ConversationsPluginOptions> = {}
): ConversationsPluginOptions => ({
	access,
	channels,
	slug: 'comments',
	targets: {
		collections: {
			media: { channels: ['internal'] },
			persons: { channels: ['internal', 'shared'] },
		},
	},
	users: ['users', 'customers'],
	...overrides,
})

export const boot = (
	db: SupportedDb,
	plugin: Plugin = conversations(instanceOptions()),
	extra: Plugin[] = []
): Promise<BootedPayload> =>
	bootPayload({ collections, configOverrides: { globals, plugins: extra }, db, plugin })

export type Session = { id: number | string; token: string; userKey: string }

export const signUp = async (
	booted: BootedPayload,
	collection: 'customers' | 'users',
	name: string
): Promise<Session> => {
	const email = `${name.toLowerCase().replace(/\W/g, '')}-${Math.random().toString(36).slice(2)}@test.dev`
	const doc = await booted.payload.create({
		collection,
		data: { email, name, password: 'password' },
	})
	const login = await booted.payload.login({ collection, data: { email, password: 'password' } })
	return { id: doc.id, token: login.token ?? '', userKey: `${collection}:${String(doc.id)}` }
}

type CallOptions = { body?: unknown; query?: Record<string, string | string[]>; session?: Session }

/** Call a plugin endpoint through Payload's REST handler: `call(booted, 'POST /path', ...)`. */
export const call = async <T = Record<string, unknown>>(
	booted: BootedPayload,
	route: `${'DELETE' | 'GET' | 'PATCH' | 'POST'} /${string}`,
	{ body, query, session }: CallOptions = {}
): Promise<{ json: T; status: number }> => {
	const [method, path] = route.split(' ') as [string, string]
	const url = new URL(`http://localhost:3000/api${path}`)
	for (const [name, value] of Object.entries(query ?? {})) {
		for (const item of Array.isArray(value) ? value : [value]) {
			url.searchParams.append(name, item)
		}
	}
	const headers = new Headers()
	if (session) {
		headers.set('Authorization', `JWT ${session.token}`)
	}
	if (body !== undefined) {
		headers.set('Content-Type', 'application/json')
	}
	const res = await handleEndpoints({
		config: booted.payload.config,
		payloadInstanceCacheKey: booted.cacheKey,
		request: new Request(url, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers,
			method,
		}),
	})
	return { json: (await res.json()) as T, status: res.status }
}

export const mentionNode = (userKey: string, label: string) => ({
	label,
	type: 'conversationsMention',
	userKey,
	version: 1,
})

export const bodyOf = (...children: object[]) => ({
	root: {
		children: [
			{
				children,
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
})

export const textNode = (text: string) => ({
	detail: 0,
	format: 0,
	mode: 'normal',
	style: '',
	text,
	type: 'text',
	version: 1,
})

export type StreamEvent = { data: Record<string, unknown>; event: string }

/**
 * Open an instance's SSE stream as `session`. `next` waits for the next event,
 * or resolves `null` after `ms`; `close` aborts it like a closed tab.
 */
export const openStream = async (
	booted: BootedPayload,
	{
		body,
		instance,
		session,
	}: { body: { since?: string; tokens: string[] }; instance: string; session: Session }
) => {
	const abort = new AbortController()
	const res = await handleEndpoints({
		config: booted.payload.config,
		payloadInstanceCacheKey: booted.cacheKey,
		request: new Request(`http://localhost:3000/api/conversations/${instance}/events`, {
			body: JSON.stringify(body),
			headers: { Authorization: `JWT ${session.token}`, 'Content-Type': 'application/json' },
			method: 'POST',
			signal: abort.signal,
		}),
	})
	const reader = (res.body as ReadableStream<Uint8Array>).getReader()
	const decoder = new TextDecoder()
	const queue: StreamEvent[] = []
	let buffer = ''
	let pending: null | Promise<void> = null
	const pump = () => {
		pending ??= reader.read().then(({ done, value }) => {
			pending = null
			if (done) return
			buffer += decoder.decode(value, { stream: true })
			const parsed = parseEvents(buffer)
			buffer = parsed.rest
			for (const entry of parsed.events) {
				queue.push({ data: JSON.parse(entry.data), event: entry.event })
			}
		})
		return pending
	}
	const next = async (ms = 3000): Promise<StreamEvent | null> => {
		const until = Date.now() + ms
		while (queue.length === 0) {
			const left = until - Date.now()
			if (left <= 0) return null
			await Promise.race([pump(), new Promise((resolve) => setTimeout(resolve, left))])
		}
		return queue.shift() ?? null
	}
	const close = async () => {
		abort.abort()
		await reader.cancel().catch(() => undefined)
	}
	return { close, next, status: res.status }
}
