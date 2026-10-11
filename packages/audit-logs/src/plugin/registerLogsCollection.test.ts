import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import type { AuditPluginConfig } from '../types'
import { buildPluginContext } from './context'
import { registerLogsCollection } from './registerLogsCollection'

const finishedLogCollection = (pluginOptions: AuditPluginConfig): CollectionConfig | undefined => {
	const config = { collections: [] } as unknown as Config
	registerLogsCollection(config, buildPluginContext(config, pluginOptions), pluginOptions)
	return config.collections?.find((collection) => collection.slug === 'audit-logs')
}

describe('registerLogsCollection', () => {
	it('exempts the log collection from content locks', () => {
		expect(finishedLogCollection({})?.custom?.contentLock?.exempt).toBe(true)
	})

	it('keeps the exemption when an override rebuilds custom without it', () => {
		const collection = finishedLogCollection({
			logs: { override: (built) => ({ ...built, custom: { team: 'ops' } }) },
		})

		expect(collection?.custom?.contentLock?.exempt).toBe(true)
		expect(collection?.custom?.team).toBe('ops')
	})

	it('keeps the exemption when an override clears it', () => {
		const collection = finishedLogCollection({
			logs: { override: (built) => ({ ...built, custom: { contentLock: { exempt: false } } }) },
		})

		expect(collection?.custom?.contentLock?.exempt).toBe(true)
	})
})
