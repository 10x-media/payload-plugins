import type { Config, Endpoint, Payload } from 'payload'

import { InProcessBroker } from '../broker/InProcessBroker'
import { createAfterChangeHook } from '../hooks/createAfterChangeHook'
import { createAfterDeleteHook } from '../hooks/createAfterDeleteHook'
import type { ResolvedSSEOptions } from '../options'
import { makePresenceHandler, PRESENCE_PATH } from '../presence/makePresenceHandler'
import { createPresenceStore } from '../presence/store'
import { makeStreamHandler, STREAM_PATH } from '../stream/makeStreamHandler'
import { registerAdmin } from './registerAdmin'
import { createEmit, getRuntime, type SSERuntime, setRuntime } from './runtime'

export const registerSSE = (args: { config: Config; options: ResolvedSSEOptions }): void => {
	const { config, options } = args
	const sourceSlugs = Object.keys(options.collections)

	config.collections ??= []
	for (let i = 0; i < config.collections.length; i++) {
		const collection = config.collections[i]
		if (!collection || !sourceSlugs.includes(collection.slug)) {
			continue
		}
		const cfg = options.collections[collection.slug]
		if (!cfg) continue

		config.collections[i] = {
			...collection,
			hooks: {
				...collection.hooks,
				afterChange: [
					...(collection.hooks?.afterChange ?? []),
					createAfterChangeHook({ collection: collection.slug, events: cfg.events }),
				],
				afterDelete: [
					...(collection.hooks?.afterDelete ?? []),
					createAfterDeleteHook({ collection: collection.slug, events: cfg.events }),
				],
			},
		}
	}

	registerAdmin({ config, options })

	const streamEndpoint: Endpoint = {
		method: 'get',
		path: STREAM_PATH,
		handler: (req) => {
			const runtime = getRuntime(req.payload)
			if (!runtime) {
				return Response.json({ message: 'sse not initialized' }, { status: 503 })
			}
			const collections: Record<string, { thinEvents: boolean }> = {}
			for (const [slug, cfg] of Object.entries(runtime.collections)) {
				collections[slug] = { thinEvents: cfg.thinEvents }
			}
			return makeStreamHandler({
				broker: runtime.broker,
				collections,
				heartbeatMs: runtime.heartbeatMs,
			})(req)
		},
	}

	const endpoints: Endpoint[] = [...(config.endpoints ?? []), streamEndpoint]

	if (options.presence !== false) {
		const presenceHandler: Endpoint['handler'] = (req) => {
			const runtime = getRuntime(req.payload)
			if (!runtime || runtime.presence === false) {
				return Response.json({ message: 'presence not enabled' }, { status: 503 })
			}
			return makePresenceHandler({
				store: runtime.presence.store,
				broker: runtime.broker,
				identify: runtime.presence.identify,
			})(req)
		}
		endpoints.push(
			{ method: 'post', path: PRESENCE_PATH, handler: presenceHandler },
			{ method: 'delete', path: PRESENCE_PATH, handler: presenceHandler }
		)
	}

	config.endpoints = endpoints

	const prevOnInit = config.onInit
	config.onInit = async (payload: Payload) => {
		const broker = options.broker ?? new InProcessBroker()
		const emit = createEmit(broker)
		const presence =
			options.presence === false
				? false
				: {
						...options.presence,
						store: createPresenceStore(payload.kv, { leaseMs: options.presence.leaseMs }),
					}
		const runtime: SSERuntime = {
			broker,
			collections: options.collections,
			heartbeatMs: options.heartbeatMs,
			presence,
			destroy: async () => {
				await broker.destroy()
			},
			emit,
		}
		setRuntime(payload, runtime)

		const prevDestroy = payload.destroy.bind(payload)
		payload.destroy = async (...destroyArgs) => {
			await runtime.destroy()
			return prevDestroy(...destroyArgs)
		}

		await prevOnInit?.(payload)
	}
}
