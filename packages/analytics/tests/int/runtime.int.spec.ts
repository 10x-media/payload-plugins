import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { getRuntime } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

describeForDb('analytics runtime stash', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [memoryAdapter()],
				collections: { pages: { path: (doc) => (doc.slug as string) ?? null } },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stashes a runtime with registry, bindings, and engine on the payload instance', () => {
		const runtime = getRuntime(booted.payload)
		expect(runtime).toBeDefined()
		expect(runtime?.registry.default().id).toBe('memory')
		expect(runtime?.bindings.pages).toBeDefined()
		expect(typeof runtime?.engine.read).toBe('function')
	})
})
