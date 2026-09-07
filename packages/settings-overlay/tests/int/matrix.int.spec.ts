import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { settingsOverlay } from '../../src/index'
import { REGISTRY_KEY } from '../../src/plugin/constants'
import type { SettingsOverlayRegistry } from '../../src/plugin/registry'

describeForDb('settingsOverlay cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [{ slug: 'tags', fields: [{ name: 'title', type: 'text' }] }],
			db,
			plugin: settingsOverlay({
				overlays: [
					{
						hideEntities: true,
						id: 'system',
						items: [{ slug: 'tags', type: 'collection' }],
						label: 'System',
					},
				],
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`hides the listed collection against ${db}`, () => {
		expect(booted.payload.collections.tags?.config.admin.hidden).toBe(true)
	})

	it(`keeps the registry server-side against ${db}`, () => {
		const registry = (booted.payload.config.custom as Record<string, SettingsOverlayRegistry>)[
			REGISTRY_KEY
		]
		expect(registry?.overlays).toHaveLength(1)
	})
})
