import type { Config, Endpoint, Payload } from 'payload'

import { InProcessBroker } from '../broker/InProcessBroker'
import { createAfterChangeHook } from '../hooks/createAfterChangeHook'
import { createAfterDeleteHook } from '../hooks/createAfterDeleteHook'
import type { ResolvedSSEOptions } from '../options'
import { makeStreamHandler, STREAM_PATH } from '../stream/makeStreamHandler'
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

	config.endpoints = [...(config.endpoints ?? []), streamEndpoint]

	const prevOnInit = config.onInit
	config.onInit = async (payload: Payload) => {
		const broker = options.broker ?? new InProcessBroker()
		const emit = createEmit(broker)
		const runtime: SSERuntime = {
			broker,
			collections: options.collections,
			heartbeatMs: options.heartbeatMs,
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
