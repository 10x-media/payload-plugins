import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { feedbackRecorder } from '../../src/index'

describeForDb('feedbackRecorder loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: feedbackRecorder({}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('payload boots with the plugin loaded and no 10x connection', () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it('adds no collection of its own', () => {
		expect(Object.keys(booted.payload.collections)).not.toContain('feedback-recorder')
	})
})
