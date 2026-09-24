import { APIError, type Endpoint, type PayloadRequest } from 'payload'

import { type FeedWindow, parseCursor } from '../server/feed'
import {
	deleteMessage,
	editMessage,
	listMessages,
	markRead,
	poll,
	searchMentions,
	sendMessage,
	subscribe,
} from '../server/service'
import type { ConversationsInstance } from '../types'

const readJson = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
	try {
		const body = (await req.json?.()) as unknown
		return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
	} catch {
		throw new APIError('Invalid JSON body', 400, undefined, true)
	}
}

const stringOf = (value: unknown): string | undefined =>
	typeof value === 'string' && value.length > 0 ? value : undefined

const requireString = (value: unknown, name: string): string => {
	const found = stringOf(value)
	if (!found) {
		throw new APIError(`${name} is required`, 400, undefined, true)
	}
	return found
}

const routeId = (req: PayloadRequest): string => requireString(req.routeParams?.id, 'id')

const windowFrom = (params: URLSearchParams): FeedWindow | undefined => {
	const before = parseCursor(params.get('before'))
	if (before) {
		return { before, mode: 'before' }
	}
	const after = parseCursor(params.get('after'))
	if (after) {
		return { after, mode: 'after' }
	}
	const around = params.get('around')
	if (around && !Number.isNaN(new Date(around).getTime())) {
		return { around: new Date(around).toISOString(), mode: 'around' }
	}
	const since = params.get('updatedSince')
	if (since && !Number.isNaN(new Date(since).getTime())) {
		return { mode: 'updatedSince', since: new Date(since).toISOString() }
	}
	if (params.get('latest') === '1') {
		return { mode: 'latest' }
	}
	return undefined
}

/**
 * The instance endpoints under `/api/conversations/<slug>`. Every data read and
 * write goes through them: they run instance access, then the Local API with
 * `overrideAccess`, since the collections themselves are closed.
 */
export const buildEndpoints = (instance: ConversationsInstance): Endpoint[] => {
	const base = `/conversations/${instance.slug}`
	return [
		{
			handler: async (req) => {
				const body = await readJson(req)
				const keys = Array.isArray(body.keys)
					? body.keys.filter((key): key is string => typeof key === 'string')
					: []
				return Response.json(await subscribe(req, instance, keys))
			},
			method: 'post',
			path: `${base}/subscribe`,
		},
		{
			handler: async (req) => {
				const params = new URL(req.url ?? 'http://localhost').searchParams
				const channels = params.getAll('channel').flatMap((value) => value.split(','))
				const limit = Number(params.get('limit') ?? 30)
				return Response.json(
					await listMessages(req, instance, {
						channels,
						key: requireString(params.get('key'), 'key'),
						limit: Number.isFinite(limit) ? limit : 30,
						parent: stringOf(params.get('parent')) ?? null,
						window: windowFrom(params),
					})
				)
			},
			method: 'get',
			path: `${base}/messages`,
		},
		{
			handler: async (req) => {
				const body = await readJson(req)
				return Response.json(
					await sendMessage(req, instance, {
						body: body.body,
						channel: stringOf(body.channel),
						clientId: stringOf(body.clientId),
						data: body.data,
						key: requireString(body.key, 'key'),
						parent: stringOf(body.parent) ?? null,
						text: typeof body.text === 'string' ? body.text : undefined,
						type: stringOf(body.type),
					}),
					{ status: 201 }
				)
			},
			method: 'post',
			path: `${base}/messages`,
		},
		{
			handler: async (req) => {
				const body = await readJson(req)
				return Response.json(
					await editMessage(req, instance, {
						body: body.body,
						id: routeId(req),
						text: typeof body.text === 'string' ? body.text : undefined,
					})
				)
			},
			method: 'patch',
			path: `${base}/messages/:id`,
		},
		{
			handler: async (req) => Response.json(await deleteMessage(req, instance, routeId(req))),
			method: 'delete',
			path: `${base}/messages/:id`,
		},
		{
			handler: async (req) => {
				const body = await readJson(req)
				await markRead(req, instance, {
					at: body.at,
					key: requireString(body.key, 'key'),
					thread: body.thread,
				})
				return Response.json({ ok: true })
			},
			method: 'post',
			path: `${base}/read`,
		},
		{
			handler: async (req) => {
				const body = await readJson(req)
				return Response.json(await poll(req, instance, { since: body.since, tokens: body.tokens }))
			},
			method: 'post',
			path: `${base}/poll`,
		},
		{
			handler: async (req) => {
				const params = new URL(req.url ?? 'http://localhost').searchParams
				return Response.json({
					users: await searchMentions(req, instance, {
						channel: requireString(params.get('channel'), 'channel'),
						key: requireString(params.get('key'), 'key'),
						q: params.get('q') ?? '',
					}),
				})
			},
			method: 'get',
			path: `${base}/mentions`,
		},
	]
}
