import { SERVER_USER_AGENT } from './device'

/**
 * Lowercase user-agent substrings of automated traffic. Hand-picked rather than a vendor list, so
 * every entry is justified against real agents and none can match a browser.
 */
export const BOT_MARKERS: ReadonlySet<string> = new Set([
	'bot',
	'crawl',
	'spider',
	'slurp',
	'headless',
	'lighthouse',
	'pagespeed',
	'gtmetrix',
	'pingdom',
	'statuscake',
	'datadog',
	'newrelic',
	'facebookexternalhit',
	'whatsapp',
	'embedly',
	'phantomjs',
	'puppeteer',
	'playwright',
	'selenium',
	'python-requests',
	'curl/',
	'wget/',
	'go-http-client',
	'okhttp',
	'axios/',
	'node-fetch',
	'java/',
	'libwww',
	'httpclient',
])

/**
 * Phone tokens stripped before scanning: `bot` must match mid-word (Googlebot) without counting
 * every Cubot handset as a crawler.
 */
const NOT_BOT_TOKENS: readonly string[] = ['cubot']

/**
 * An empty agent counts as automated (every real browser sends one); the synthetic server agent
 * never does, since that call is trusted host code.
 */
export const isBot = (ua: string): boolean => {
	if (ua === SERVER_USER_AGENT) {
		return false
	}
	let agent = ua.trim().toLowerCase()
	if (agent === '') {
		return true
	}
	for (const token of NOT_BOT_TOKENS) {
		agent = agent.replaceAll(token, '')
	}
	for (const marker of BOT_MARKERS) {
		if (agent.includes(marker)) {
			return true
		}
	}
	return false
}

export type BotFilter = (ua: string) => boolean

/**
 * `filterBots` option as one predicate. A throwing host filter propagates to the handler, which
 * keeps the event and logs once; swallowing it here would hide a broken predicate.
 */
export const resolveBotFilter = (option: boolean | BotFilter | undefined): BotFilter => {
	if (option === false) {
		return () => false
	}
	return typeof option === 'function' ? option : isBot
}
