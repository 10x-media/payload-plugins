import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { readForField } from '../../src/fields/readForDocument'
import { analytics } from '../../src/index'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'

const ingest = (booted: BootedPayload, path: string) =>
	makeIngestHandler(platformHeaderResolver)({
		payload: booted.payload,
		headers: new Headers({
			'content-type': 'application/json',
			'user-agent': 'UA',
			'x-vercel-ip-country': 'US',
		}),
		json: async () => ({ type: 'pageview', path, hostname: 'h', durationMs: 400 }),
	} as never)

describeForDb('analytics readForField', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				collections: { pages: { path: (doc) => (doc.slug as string) ?? null } },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const req = () => ({ payload: booted.payload, locale: undefined }) as unknown as PayloadRequest

	it('reads per-document totals through the engine', async () => {
		await ingest(booted, '/p')
		await ingest(booted, '/p')
		const result = await readForField({
			req: req(),
			collectionSlug: 'pages',
			data: { slug: '/p' },
			metrics: ['pageviews', 'visitors', 'avgDuration'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(result.status).toBe('ok')
		expect(result.metrics.pageviews).toBe(2)
		expect(result.metrics.visitors).toBe(1)
		expect(result.metrics.avgDuration).toBe(400)
	})

	it('returns no-path for an unsaved document', async () => {
		const result = await readForField({
			req: req(),
			collectionSlug: 'pages',
			data: {},
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(result.status).toBe('no-path')
	})

	it('returns not-bound for a collection with no binding', async () => {
		const result = await readForField({
			req: req(),
			collectionSlug: 'unbound',
			data: { slug: '/p' },
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(result.status).toBe('not-bound')
	})

	it('returns unavailable when no requested metric is supported', async () => {
		const result = await readForField({
			req: req(),
			collectionSlug: 'pages',
			data: { slug: '/p' },
			metrics: ['bounceRate'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(result.status).toBe('unavailable')
		expect(result.supportedMetrics).toEqual([])
		expect(result.droppedMetrics).toEqual(['bounceRate'])
	})

	it('drops unsupported metrics, reads the rest, and warns once with the dropped names', async () => {
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		const result = await readForField({
			req: req(),
			collectionSlug: 'pages',
			data: { slug: '/p' },
			metrics: ['pageviews', 'bounceRate', 'scrollDepth'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(result.status).toBe('ok')
		expect(result.supportedMetrics).toEqual(['pageviews'])
		expect(result.droppedMetrics).toEqual(['bounceRate', 'scrollDepth'])
		expect(result.metrics.pageviews).toBe(2)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/native.*bounceRate, scrollDepth/s)
		)
		warn.mockRestore()
	})

	it('does not warn when every requested metric is supported', async () => {
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		const result = await readForField({
			req: req(),
			collectionSlug: 'pages',
			data: { slug: '/p' },
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: new Date(),
		})
		expect(result.status).toBe('ok')
		expect(result.droppedMetrics).toEqual([])
		expect(warn).not.toHaveBeenCalled()
		warn.mockRestore()
	})

	it('returns unavailable for an unknown adapter id', async () => {
		const result = await readForField({
			req: req(),
			collectionSlug: 'pages',
			data: { slug: '/p' },
			metrics: ['pageviews'],
			timeframe: 'last30days',
			adapterId: 'does-not-exist',
			now: new Date(),
		})
		expect(result.status).toBe('unavailable')
	})
})
