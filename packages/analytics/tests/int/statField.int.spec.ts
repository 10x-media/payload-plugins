import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { isValidElement, type ReactNode } from 'react'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { AnalyticsStatField } from '../../src/fields/AnalyticsStatField'
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
		json: async () => ({ type: 'pageview', path, hostname: 'h', durationMs: 100 }),
	} as never)

const flatten = (node: ReactNode): string => {
	if (node === null || node === undefined || typeof node === 'boolean') return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(flatten).join(' ')
	if (isValidElement(node)) {
		return flatten((node.props as { children?: ReactNode }).children)
	}
	return ''
}

const i18nStub = { t: (key: string) => key, language: 'en' }

describeForDb('analytics stat field render', { dbs: ['mongo'] }, (db) => {
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

	it('renders the resolved pageview count and metric label', async () => {
		await ingest(booted, '/render')
		await ingest(booted, '/render')
		const element = await AnalyticsStatField({
			req: { payload: booted.payload, locale: undefined } as unknown as PayloadRequest,
			data: { slug: '/render' },
			collectionSlug: 'pages',
			i18n: i18nStub,
			metrics: ['pageviews'],
			timeframe: 'last30days',
			variant: 'stat',
		})
		const text = flatten(element)
		expect(text).toContain('2')
		expect(text).toContain('analytics:metricPageviews')
	})

	it('renders an empty state for an unsaved document', async () => {
		const element = await AnalyticsStatField({
			req: { payload: booted.payload, locale: undefined } as unknown as PayloadRequest,
			data: {},
			collectionSlug: 'pages',
			i18n: i18nStub,
			metrics: ['pageviews'],
			timeframe: 'last30days',
			variant: 'stat',
		})
		expect(flatten(element)).toContain('analytics:stateNoData')
	})
})
