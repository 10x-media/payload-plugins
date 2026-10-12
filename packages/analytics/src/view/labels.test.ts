import { describe, expect, it } from 'vitest'
import { TRAFFIC_CHANNELS } from '../native/ingest/source'
import { keys } from '../translations/keys'
import type { Translate } from '../translations/server'
import { CHANNEL_LABELS, countryCode, itemLabel, valueLabel } from './labels'

const t: Translate = (key) => `t(${key})`

const native = (dimension: Parameters<typeof valueLabel>[0]['dimension'], value: string): string =>
	valueLabel({ dimension, value, provider: 'native', t })

describe('valueLabel', () => {
	it('names every traffic channel the native channel dimension can hold', () => {
		for (const channel of TRAFFIC_CHANNELS) {
			expect(native('channel', channel)).toBe(`t(${CHANNEL_LABELS[channel]})`)
		}
	})

	it('translates a channel through its own key', () => {
		expect(native('channel', 'organic-search')).toBe(`t(${keys.channelOrganicSearch})`)
	})

	it('names the direct source, which is the one origin that is not a name', () => {
		expect(native('source', 'direct')).toBe(`t(${keys.channelDirect})`)
	})

	it('reads a host or a campaign tag under source as it was stored', () => {
		expect(native('source', 'google.com')).toBe('google.com')
		// A `utm_source` reading `email` is the tag, not the Email channel.
		expect(native('source', 'email')).toBe('email')
	})

	it('answers a prototype member name as itself', () => {
		expect(native('channel', 'constructor')).toBe('constructor')
		expect(native('channel', '__proto__')).toBe('__proto__')
		expect(native('source', 'constructor')).toBe('constructor')
	})

	it("leaves a provider's own vocabulary raw on both dimensions", () => {
		expect(valueLabel({ dimension: 'source', value: 'direct', provider: 'plausible', t })).toBe(
			'direct'
		)
		expect(valueLabel({ dimension: 'channel', value: 'Paid Search', provider: 'ga4', t })).toBe(
			'Paid Search'
		)
	})

	it('names an empty value on any dimension and any source', () => {
		expect(native('channel', '')).toBe(`t(${keys.valueNotSet})`)
		expect(native('source', '   ')).toBe(`t(${keys.valueNotSet})`)
		expect(valueLabel({ dimension: 'channel', value: '', provider: 'posthog', t })).toBe(
			`t(${keys.valueNotSet})`
		)
		expect(valueLabel({ dimension: 'page', value: '\t', provider: 'plausible', t })).toBe(
			`t(${keys.valueNotSet})`
		)
	})

	it('leaves every other dimension raw', () => {
		expect(native('referrer', 'direct')).toBe('direct')
		expect(native('page', '/pricing')).toBe('/pricing')
		expect(native('utmMedium', 'email')).toBe('email')
	})
})

describe('valueLabel country', () => {
	const country = (value: string, locale?: string): string =>
		valueLabel({
			dimension: 'country',
			value,
			provider: 'native',
			t,
			...(locale === undefined ? {} : { locale }),
		})

	it('names the country in the admin language', () => {
		expect(country('DE', 'en')).toBe('Germany')
		expect(country('DE', 'de')).toBe('Deutschland')
	})

	it('names a lower-case code, which is how some sources store one', () => {
		expect(country('de', 'en')).toBe('Germany')
		expect(country(' de ', 'en')).toBe('Germany')
	})

	it('reads English when no admin language was passed', () => {
		expect(country('FR')).toBe('France')
	})

	it('reads a value that is not an ISO code exactly as it was stored', () => {
		// A provider answering a name rather than a code must not be guessed at.
		expect(country('Germany', 'en')).toBe('Germany')
		expect(country('DEU', 'en')).toBe('DEU')
		expect(country('D1', 'en')).toBe('D1')
	})

	it('answers a prototype member name as itself', () => {
		expect(country('constructor', 'en')).toBe('constructor')
		expect(country('__proto__', 'en')).toBe('__proto__')
	})
})

describe('valueLabel language', () => {
	const language = (value: string, locale = 'en'): string =>
		valueLabel({ dimension: 'language', value, provider: 'native', t, locale })

	it('names the language in the admin language', () => {
		expect(language('de', 'en')).toBe('German')
		expect(language('de', 'de')).toBe('Deutsch')
	})

	it('upper-cases the region subtag native ingest lower-cases', () => {
		// `de-de` would otherwise fall through to its raw form on every regional variant.
		expect(language('de-de', 'en')).toBe('German (Germany)')
		expect(language('pt-br', 'en')).toBe('Brazilian Portuguese')
	})

	it('reads a token that is not a language tag as it was stored', () => {
		expect(language('klingon', 'en')).toBe('klingon')
	})

	it('answers a prototype member name as itself', () => {
		expect(language('constructor', 'en')).toBe('constructor')
		expect(language('__proto__', 'en')).toBe('__proto__')
	})
})

describe('valueLabel device, browser and os', () => {
	const label = (dimension: 'device' | 'browser' | 'os', value: string): string =>
		valueLabel({ dimension, value, provider: 'native', t })

	it('names the devices the sources classify into', () => {
		expect(label('device', 'desktop')).toBe(`t(${keys.valueDeviceDesktop})`)
		expect(label('device', 'mobile')).toBe(`t(${keys.valueDeviceMobile})`)
		expect(label('device', 'tablet')).toBe(`t(${keys.valueDeviceTablet})`)
	})

	it('names one browser however a source spells it', () => {
		for (const spelling of ['chrome', 'Chrome', 'Google Chrome', 'google-chrome']) {
			expect(label('browser', spelling)).toBe(`t(${keys.valueBrowserChrome})`)
		}
		expect(label('browser', 'Mobile Safari')).toBe(`t(${keys.valueBrowserSafari})`)
		expect(label('browser', 'Samsung Internet')).toBe(`t(${keys.valueBrowserSamsung})`)
	})

	it('names one operating system however a source spells it', () => {
		for (const spelling of ['macos', 'macOS', 'Mac OS X', 'osx']) {
			expect(label('os', spelling)).toBe(`t(${keys.valueOsMacos})`)
		}
		expect(label('os', 'Chrome OS')).toBe(`t(${keys.valueOsChromeos})`)
	})

	it('names the catch-all bucket a source reports', () => {
		expect(label('browser', 'other')).toBe(`t(${keys.valueOther})`)
		expect(label('os', 'Other')).toBe(`t(${keys.valueOther})`)
	})

	it('reads a token the table does not hold as it was stored', () => {
		expect(label('browser', 'Vivaldi')).toBe('Vivaldi')
		expect(label('os', 'FreeBSD')).toBe('FreeBSD')
		expect(label('device', 'watch')).toBe('watch')
	})

	it('answers a prototype member name as itself', () => {
		// The table is a Map, so a token naming an Object member is an ordinary miss.
		expect(label('browser', 'constructor')).toBe('constructor')
		expect(label('os', '__proto__')).toBe('__proto__')
		expect(label('device', 'toString')).toBe('toString')
	})

	it('names them for a provider too, since all of them classify the same way', () => {
		expect(valueLabel({ dimension: 'os', value: 'iOS', provider: 'posthog', t })).toBe(
			`t(${keys.valueOsIos})`
		)
	})
})

describe('valueLabel goal', () => {
	const goals = [
		{ slug: 'newsletter-signup', name: 'Newsletter signup' },
		{ slug: 'book-demo', name: 'Book a demo' },
	]

	const goal = (value: string, over?: typeof goals): string =>
		valueLabel({ dimension: 'goal', value, provider: 'native', t, goals: over ?? goals })

	it('reads a goal row as the goal name', () => {
		expect(goal('newsletter-signup')).toBe('Newsletter signup')
		expect(goal('book-demo')).toBe('Book a demo')
	})

	it('reads a slug no configured goal matches as the slug', () => {
		// A goal deleted after the read still has rows, and the slug is what identifies it.
		expect(goal('gone')).toBe('gone')
		expect(goal('newsletter-signup', [])).toBe('newsletter-signup')
	})

	it('reads the slug when the view passed no goals at all', () => {
		expect(valueLabel({ dimension: 'goal', value: 'book-demo', provider: 'native', t })).toBe(
			'book-demo'
		)
	})
})

describe('countryCode', () => {
	it('upper-cases and trims a stored alpha-2 code', () => {
		expect(countryCode('DE')).toBe('DE')
		expect(countryCode('de')).toBe('DE')
		expect(countryCode(' de ')).toBe('DE')
	})

	it('gives nothing for anything that is not an ISO alpha-2 code', () => {
		// A provider answering a name rather than a code gets no flag, not a wrong one.
		expect(countryCode('Germany')).toBeNull()
		expect(countryCode('DEU')).toBeNull()
		expect(countryCode('D1')).toBeNull()
		expect(countryCode('')).toBeNull()
		expect(countryCode('  ')).toBeNull()
	})
})

describe('item labels', () => {
	const labels = { 'offers:1': 'Spring sale', 'offers:2': null }

	it('names an item by the title the server resolved for it', () => {
		expect(
			valueLabel({
				dimension: 'item',
				value: 'offers:1',
				provider: 'native',
				t,
				itemLabels: labels,
			})
		).toBe('Spring sale')
	})

	it('reads a removed or hidden item as one, never as its ref', () => {
		expect(itemLabel('offers:2', labels, t)).toBe(`t(${keys.itemRemoved})`)
		expect(itemLabel('offers:404', labels, t)).toBe(`t(${keys.itemRemoved})`)
	})

	it('says the title is on its way until an answer has arrived', () => {
		expect(itemLabel('offers:1', undefined, t)).toBe(`t(${keys.valueLoading})`)
	})
})
