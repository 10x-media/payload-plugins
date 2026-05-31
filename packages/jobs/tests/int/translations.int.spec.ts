import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { jobs } from '../../src/index'

type NestedTranslations = Record<string, Record<string, Record<string, string>> | undefined>

/** The plugin's English namespace as merged into the sanitized config. */
const namespace = (booted: BootedPayload): Record<string, string> | undefined =>
	(booted.payload.config.i18n?.translations as NestedTranslations | undefined)?.en?.jobs

describeForDb('jobs i18n registration', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: jobs({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('merges the plugin namespace into config translations', () => {
		const en = namespace(booted)
		expect(en?.pluginName).toBe('Jobs')
		expect(en?.statusSucceeded).toBe('Succeeded')
		expect(en?.fieldQueue).toBe('Queue')
		expect(en?.noAttempts).toBe('No attempts recorded yet.')
	})
})
