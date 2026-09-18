import { devices } from 'playwright'
import { describe, expect, it } from 'vitest'
import { BOT_MARKERS, isBot, resolveBotFilter } from './bots'
import { SERVER_USER_AGENT } from './device'

/** Real agents, one per family the marker list claims to cover. */
const BOTS: ReadonlyArray<[string, string]> = [
	['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
	['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
	['DuckDuckBot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
	['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
	[
		'Baiduspider',
		'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
	],
	['AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
	['SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
	[
		'Yahoo Slurp',
		'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
	],
	[
		'facebookexternalhit',
		'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
	],
	['Twitterbot', 'Twitterbot/1.0'],
	[
		'LinkedInBot',
		'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
	],
	['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
	['Discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
	['TelegramBot', 'TelegramBot (like TwitterBot)'],
	['WhatsApp link preview', 'WhatsApp/2.23.20.0 A'],
	['Embedly', 'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)'],
	[
		'Lighthouse',
		'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
	],
	[
		'PageSpeed Insights',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PagespeedInsights',
	],
	[
		'GTmetrix',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.134 Safari/537.36 GTmetrix',
	],
	['Pingdom', 'Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)'],
	['UptimeRobot', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
	[
		'StatusCake',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36 StatusCake',
	],
	[
		'Datadog Synthetics',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 DatadogSynthetics',
	],
	[
		'New Relic Synthetics',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36 NewRelicSynthetics',
	],
	[
		'HeadlessChrome',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.109 Safari/537.36',
	],
	[
		'PhantomJS',
		'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1',
	],
	[
		'a self-identified Playwright run',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Playwright/1.60',
	],
	['Selenium', 'Mozilla/5.0 (compatible; Selenium/4.18.1)'],
	['Puppeteer', 'Mozilla/5.0 (compatible; Puppeteer/22.0.0)'],
	['curl', 'curl/8.4.0'],
	['wget', 'Wget/1.21.3'],
	['python-requests', 'python-requests/2.31.0'],
	['Go-http-client', 'Go-http-client/2.0'],
	['okhttp', 'okhttp/4.12.0'],
	['axios', 'axios/1.6.7'],
	['node-fetch', 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)'],
	['Java', 'Java/17.0.9'],
	['Apache HttpClient', 'Apache-HttpClient/4.5.13 (Java/1.8.0_292)'],
	['libwww-perl', 'libwww-perl/6.67'],
]

/** Agents a visitor really browses with. Every one of these has to survive the filter. */
const HUMANS: ReadonlyArray<[string, string]> = [
	[
		'Chrome on Windows',
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
	],
	[
		'Chrome on Android',
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.112 Mobile Safari/537.36',
	],
	[
		'Safari on macOS',
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
	],
	[
		'Safari on iOS',
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
	],
	[
		'Firefox on Windows',
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
	],
	['Firefox on Android', 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0'],
	[
		'Edge on Windows',
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.67',
	],
	[
		'Edge on Android',
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 EdgA/125.0.2535.51',
	],
	[
		'Samsung Internet',
		'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
	],
	[
		'the Instagram in-app browser',
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 329.0.0.41.93 (iPhone15,3; iOS 17_4; en_US; en-US; scale=3.00; 1290x2796)',
	],
	[
		'the Facebook in-app browser',
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
	],
	[
		'a Cubot phone, whose model name carries the bot marker',
		'Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.74 Mobile Safari/537.36',
	],
]

describe('isBot', () => {
	for (const [family, ua] of BOTS) {
		it(`drops ${family}`, () => {
			expect(isBot(ua)).toBe(true)
		})
	}

	for (const [family, ua] of HUMANS) {
		it(`keeps ${family}`, () => {
			expect(isBot(ua)).toBe(false)
		})
	}

	it('treats an agent that says nothing as automated', () => {
		expect(isBot('')).toBe(true)
		expect(isBot('   ')).toBe(true)
	})

	it('never treats a trusted server event as a bot', () => {
		expect(isBot(SERVER_USER_AGENT)).toBe(false)
	})

	it('matches whatever case the agent arrives in', () => {
		expect(isBot('GOOGLEBOT/2.1')).toBe(true)
		expect(BOT_MARKERS.has('bot')).toBe(true)
		for (const marker of BOT_MARKERS) {
			expect(marker).toBe(marker.toLowerCase())
		}
	})

	// The e2e suite and the dev app capture through a Playwright-driven browser, so the agent
	// its device descriptor sets has to pass the filter or they stop capturing entirely.
	it('keeps the agent Playwright drives the e2e browser with', () => {
		const ua = devices['Desktop Chrome']?.userAgent
		expect(ua).toBeDefined()
		expect(isBot(ua ?? '')).toBe(false)
	})
})

describe('resolveBotFilter', () => {
	const bot = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

	it('filters with the built-in list by default', () => {
		expect(resolveBotFilter(undefined)(bot)).toBe(true)
		expect(resolveBotFilter(true)(bot)).toBe(true)
	})

	it('keeps everything when the option is off', () => {
		expect(resolveBotFilter(false)(bot)).toBe(false)
		expect(resolveBotFilter(false)('')).toBe(false)
	})

	it('honours a host filter of its own', () => {
		const filter = resolveBotFilter((ua) => ua.includes('internal-probe'))
		expect(filter('internal-probe/1.0')).toBe(true)
		expect(filter(bot)).toBe(false)
	})

	it('keeps the event when a host filter throws', () => {
		const filter = resolveBotFilter(() => {
			throw new Error('boom')
		})
		expect(filter(bot)).toBe(false)
	})
})
