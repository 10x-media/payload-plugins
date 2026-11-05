import { expect } from 'vitest'
import { formatDuration } from '../fields/format'

/** Durations as the admin writes them, which server render and hydration must both produce. */
export const DURATION_CASES: ReadonlyArray<{ ms: number; locale: string; text: string }> = [
	{ ms: 0, locale: 'en', text: '0s' },
	{ ms: 45_000, locale: 'en', text: '45s' },
	{ ms: 83_000, locale: 'en', text: '1m 23s' },
	{ ms: 3_603_000, locale: 'en', text: '1h 3s' },
	{ ms: 3_723_000, locale: 'en', text: '1h 2m 3s' },
	{ ms: 83_000, locale: 'de', text: '1 Min., 23 Sek.' },
	{ ms: 3_723_000, locale: 'ru', text: '1 ч 2 мин 3 с' },
]

/**
 * Formats durations in locales nothing has formatted yet while `Intl.DurationFormat` throws when
 * touched: the runtime having it or not (browsers do, Node 22 does not) changes nothing.
 */
export const expectNoDurationFormat = (locales: readonly string[]): void => {
	const descriptor = Object.getOwnPropertyDescriptor(Intl, 'DurationFormat')
	Object.defineProperty(Intl, 'DurationFormat', {
		configurable: true,
		writable: true,
		value: () => {
			throw new Error('Intl.DurationFormat was consulted')
		},
	})
	try {
		for (const locale of locales) {
			expect(formatDuration(3_723_000, locale)).toMatch(/1.*2.*3/s)
		}
	} finally {
		if (descriptor) {
			Object.defineProperty(Intl, 'DurationFormat', descriptor)
		} else {
			Reflect.deleteProperty(Intl, 'DurationFormat')
		}
	}
}
