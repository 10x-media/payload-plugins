import { describe, expect, it } from 'vitest'

import {
	collectCustomEventDependencies,
	collectSlotDependencies,
	resolveCustomEventComponent,
} from './customEventComponents'

describe('resolveCustomEventComponent', () => {
	const components = {
		'*': '/any#Any',
		order_refunded: '/refund#Refund',
		export_downloaded: false as const,
	}

	it('prefers the event type, then the wildcard', () => {
		expect(resolveCustomEventComponent(components, 'order_refunded')).toBe('/refund#Refund')
		expect(resolveCustomEventComponent(components, 'order_paid')).toBe('/any#Any')
	})

	it('keeps the default block for false, wildcard included', () => {
		expect(resolveCustomEventComponent(components, 'export_downloaded')).toBeUndefined()
		expect(resolveCustomEventComponent({ '*': false }, 'order_paid')).toBeUndefined()
	})

	it('ignores inherited keys and missing config', () => {
		expect(resolveCustomEventComponent({}, 'toString')).toBeUndefined()
		expect(resolveCustomEventComponent(undefined, 'order_paid')).toBeUndefined()
	})
})

describe('collectCustomEventDependencies', () => {
	it('registers every renderer under its event type and skips false', () => {
		expect(
			collectCustomEventDependencies({
				order_refunded: '/refund#Refund',
				'*': { path: '/any#Any', clientProps: { compact: true } },
				export_downloaded: false,
			})
		).toEqual({
			'@10x-media/audit-logs:customEvent:order_refunded': {
				path: '/refund#Refund',
				type: 'component',
			},
			'@10x-media/audit-logs:customEvent:*': {
				clientProps: { compact: true },
				path: '/any#Any',
				type: 'component',
			},
		})
	})
})

describe('collectSlotDependencies', () => {
	it('registers every slot component, single or listed, by slot and position', () => {
		expect(
			collectSlotDependencies({
				rowBadges: ['/badges#A', { path: '/badges#B', serverProps: { tone: 'quiet' } }],
				user: '/user#Popover',
			})
		).toEqual({
			'@10x-media/audit-logs:rowBadges:0': { path: '/badges#A', type: 'component' },
			'@10x-media/audit-logs:rowBadges:1': {
				path: '/badges#B',
				serverProps: { tone: 'quiet' },
				type: 'component',
			},
			'@10x-media/audit-logs:user:0': { path: '/user#Popover', type: 'component' },
		})
	})

	it('is empty without slots', () => {
		expect(collectSlotDependencies(undefined)).toEqual({})
	})
})
