import { createHash, createHmac } from 'node:crypto'
import type { Endpoint, PayloadRequest } from 'payload'

import { getInstance, viewerKey } from '../server/service'
import { verifyToken } from '../server/tokens'
import { parseKey } from '../shared/keys'
import { PUSHER_EVENT, pusherChannelName } from '../shared/pusher'
import type { ConversationsServerTransport, PusherClientOptions } from '../types'

export type PusherTransportOptions = {
	appId: string
	/** Pusher's cluster, e.g. `eu`; ignored when `host` is set. */
	cluster?: string
	/** What the browser connects to; defaults follow `cluster` / `host` / `port`. */
	client?: Partial<PusherClientOptions>
	/** A Pusher-compatible server (Soketi, a self-hosted gateway): its REST host. */
	host?: string
	key: string
	port?: number
	secret: string
	/** Default `true`. */
	useTLS?: boolean
}

const hmac = (secret: string, value: string) =>
	createHmac('sha256', secret).update(value).digest('hex')

const readBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
	try {
		const body = (await req.json?.()) as unknown
		return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
	} catch {
		return {}
	}
}

/**
 * Realtime through Pusher or any service that speaks its protocol (Soketi,
 * Ably's Pusher endpoint), for hosts that cannot keep a connection open
 * themselves, like serverless functions. Payload only makes an HTTP call per
 * change; the service holds the browsers' sockets.
 *
 * Each (instance, key, channel) is a private Pusher channel. The browser
 * authorizes a subscription with the subscription token `subscribe` gave it,
 * at `POST /api/conversations/<instance>/pusher-auth`, so the check costs no
 * query and nobody hears a channel they cannot read. Only "these keys
 * changed" travels; messages load through the usual endpoints.
 *
 * No dependency: the REST call is signed here, and the browser half speaks
 * the socket protocol itself.
 */
export const pusherTransport = (options: PusherTransportOptions): ConversationsServerTransport => {
	const useTLS = options.useTLS ?? true
	const host = options.host ?? `api-${options.cluster ?? 'mt1'}.pusher.com`
	const origin = `${useTLS ? 'https' : 'http'}://${host}${options.port ? `:${options.port}` : ''}`
	const path = `/apps/${options.appId}/events`
	const client: PusherClientOptions = {
		...(options.host
			? { forceTLS: useTLS, wsHost: options.host, wsPort: options.port }
			: { cluster: options.cluster ?? 'mt1' }),
		key: options.key,
		...options.client,
	}

	/** Pusher's REST `POST /events`, signed with the app secret. */
	const trigger = async (channels: string[], data: unknown) => {
		const body = JSON.stringify({ channels, data: JSON.stringify(data), name: PUSHER_EVENT })
		const params: Record<string, string> = {
			auth_key: options.key,
			auth_timestamp: String(Math.floor(Date.now() / 1000)),
			auth_version: '1.0',
			body_md5: createHash('md5').update(body).digest('hex'),
		}
		const query = Object.keys(params)
			.sort()
			.map((name) => `${name}=${params[name]}`)
			.join('&')
		const signature = hmac(options.secret, `POST\n${path}\n${query}`)
		const res = await fetch(`${origin}${path}?${query}&auth_signature=${signature}`, {
			body,
			headers: { 'Content-Type': 'application/json' },
			method: 'POST',
		})
		if (!res.ok) throw new Error(`Pusher answered ${res.status}: ${await res.text()}`)
	}

	return {
		client: { pusher: client },
		endpoints: ({ base, instance }): Endpoint[] => [
			{
				handler: async (req) => {
					const viewer = viewerKey(req)
					const body = await readBody(req)
					const socketId = typeof body.socketId === 'string' ? body.socketId : ''
					const channelName = typeof body.channelName === 'string' ? body.channelName : ''
					const claims = verifyToken(req.payload.secret, body.token)
					const allowed =
						/^\d+\.\d+$/.test(socketId) &&
						claims !== null &&
						claims.instance === instance.slug &&
						claims.userKey === viewer &&
						claims.channels.some(
							(channel) => pusherChannelName(instance.slug, claims.key, channel) === channelName
						)
					if (!allowed) return Response.json({ message: 'Forbidden' }, { status: 403 })
					return Response.json({
						auth: `${options.key}:${hmac(options.secret, `${socketId}:${channelName}`)}`,
					})
				},
				method: 'post',
				path: `${base}/pusher-auth`,
			},
		],
		publish: async ({ channel, instance: slug, key, req }) => {
			const instance = getInstance(req, slug)
			const target = parseKey(key)
			const channels = channel ? [channel] : target ? instance.channelsFor(target) : []
			if (channels.length === 0) return
			try {
				await trigger(
					channels.map((name) => pusherChannelName(slug, key, name)),
					{ keys: [key] }
				)
			} catch (error) {
				// The change is saved; a lost signal only delays it until the next reconnect or poll.
				req.payload.logger.error({ err: error, msg: '[conversations] Pusher trigger failed' })
			}
		},
	}
}
