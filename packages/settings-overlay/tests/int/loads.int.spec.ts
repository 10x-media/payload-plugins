import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { settingsOverlay } from '../../src/index'
import {
	ACTIONS_PATH,
	DISPATCHER_WIDGET_SLUG,
	REGISTRY_KEY,
	REPORTER_PATH,
} from '../../src/plugin/constants'
import type { SettingsOverlayRegistry } from '../../src/plugin/registry'

describeForDb('settingsOverlay loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [
				{ slug: 'tags', fields: [{ name: 'title', type: 'text' }] },
				{ slug: 'sites', fields: [{ name: 'title', type: 'text' }] },
			],
			db,
			plugin: settingsOverlay({
				overlays: [
					{
						id: 'system',
						items: [
							{ slug: 'tags', type: 'collection' },
							{ component: './A#A', label: 'A', lazy: true, slug: 'a', type: 'component' },
						],
						label: 'System',
					},
				],
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('hides the listed collection and leaves the rest alone', () => {
		expect(booted.payload.collections.tags?.config.admin.hidden).toBe(true)
		expect(booted.payload.collections.sites?.config.admin.hidden).toBeFalsy()
	})

	it('adds the reporter and the actions menu to the listed collection', () => {
		expect(
			booted.payload.collections.tags?.config.admin.components?.edit?.beforeDocumentControls
		).toEqual([REPORTER_PATH, ACTIONS_PATH])
	})

	it('parks the full config under custom, which never reaches the browser', () => {
		const registry = (booted.payload.config.custom as Record<string, SettingsOverlayRegistry>)[
			REGISTRY_KEY
		]
		expect(registry?.overlays[0]?.id).toBe('system')
	})

	it('registers the dispatcher widget because a lazy item is configured', () => {
		expect(
			booted.payload.config.admin.dashboard?.widgets.some(
				(widget) => widget.slug === DISPATCHER_WIDGET_SLUG
			)
		).toBe(true)
	})
})
