import type { Plugin } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type BootedPayload, bootPayload } from '../src/bootPayload'

const passthroughPlugin: Plugin = (incoming) => incoming

describe('bootPayload [db=mongo]', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: passthroughPlugin, db: 'mongo' })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('returns a working payload instance with no collections', () => {
		expect(booted.payload).toBeDefined()
		expect(booted.payload.collections).toBeDefined()
		expect(booted.db).toBe('mongo')
	})

	it('payload instance exposes a create function', () => {
		expect(typeof booted.payload.create).toBe('function')
	})
})
