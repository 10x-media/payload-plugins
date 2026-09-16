import { describe, expect, it } from 'vitest'
import { type BrowserName, classifyBrowser, classifyOs, type OsName } from './browser'
import { SERVER_USER_AGENT } from './device'

interface Agent {
	label: string
	ua: string
	browser?: BrowserName
	os?: OsName
}

const AGENTS: Agent[] = [
	{
		label: 'Chrome on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
		browser: 'chrome',
		os: 'windows',
	},
	{
		label: 'Chrome on Android',
		ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
		browser: 'chrome',
		os: 'android',
	},
	{
		label: 'Chrome on iOS (CriOS)',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
		browser: 'chrome',
		os: 'ios',
	},
	{
		label: 'Safari on macOS',
		ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
		browser: 'safari',
		os: 'macos',
	},
	{
		label: 'Safari on iOS',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
		browser: 'safari',
		os: 'ios',
	},
	{
		label: 'Safari on iPadOS',
		ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
		browser: 'safari',
		os: 'ios',
	},
	{
		label: 'Firefox on Windows',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
		browser: 'firefox',
		os: 'windows',
	},
	{
		label: 'Firefox on Android',
		ua: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
		browser: 'firefox',
		os: 'android',
	},
	{
		label: 'Firefox on iOS (FxiOS)',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
		browser: 'firefox',
		os: 'ios',
	},
	{
		label: 'Edge on Windows (Edg)',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
		browser: 'edge',
		os: 'windows',
	},
	{
		label: 'Edge on Android (EdgA)',
		ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.2592.68',
		browser: 'edge',
		os: 'android',
	},
	{
		label: 'Edge on iOS (EdgiOS)',
		ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/126.0.2592.68 Version/17.0 Mobile/15E148 Safari/604.1',
		browser: 'edge',
		os: 'ios',
	},
	{
		label: 'legacy Edge on Windows (Edge/)',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/18.17763',
		browser: 'edge',
		os: 'windows',
	},
	{
		label: 'Opera Touch on Android (OPT)',
		ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 OPT/4.2.2',
		browser: 'opera',
		os: 'android',
	},
	{
		label: 'Opera on Windows (OPR)',
		ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
		browser: 'opera',
		os: 'windows',
	},
	{
		label: 'Samsung Internet',
		ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
		browser: 'samsung',
		os: 'android',
	},
	{
		label: 'Chrome on ChromeOS',
		ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
		browser: 'chrome',
		os: 'chromeos',
	},
	{
		label: 'Firefox on Linux',
		ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
		browser: 'firefox',
		os: 'linux',
	},
	{
		label: 'a Microsoft Office client (no CrOS despite the substring)',
		ua: 'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.14026; Pro)',
		browser: 'other',
		os: 'windows',
	},
	{ label: 'curl', ua: 'curl/8.4.0', browser: 'other', os: 'other' },
	{
		label: 'Googlebot',
		ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
		browser: 'other',
		os: 'other',
	},
	{ label: 'the synthetic server agent', ua: SERVER_USER_AGENT },
]

describe('classifyBrowser and classifyOs', () => {
	it.each(AGENTS)('classifies $label', ({ ua, browser, os }) => {
		expect(classifyBrowser(ua)).toBe(browser)
		expect(classifyOs(ua)).toBe(os)
	})

	it('falls back to other for an empty user agent', () => {
		expect(classifyBrowser('')).toBe('other')
		expect(classifyOs('')).toBe('other')
	})
})
