import { SERVER_USER_AGENT } from './device'

/**
 * Lowercase substrings of the user agents automated traffic announces itself with: crawlers
 * and their preview fetchers, uptime and performance monitors, headless browsers and the
 * default agents of HTTP clients. Deliberately small and hand-held rather than a vendor list,
 * so every entry can be justified against real agents and none of them can match a browser.
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
 * Device tokens that contain a marker and belong to a real phone. The agent is scanned with
 * them removed, because `bot` has to keep matching mid-word (Googlebot, AhrefsBot) and would
 * otherwise count every Cubot handset as a crawler.
 */
const NOT_BOT_TOKENS: readonly string[] = ['cubot']

/**
 * Whether a user agent belongs to automated traffic. An agent that says nothing counts as
 * automated (every real browser sends one); the synthetic agent of a server event never does,
 * since that call is trusted host code rather than a request off the internet.
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
 * The `filterBots` option as one predicate. A host filter that throws throws through to the
 * handler, which keeps the event and says so once: swallowing it here would leave a broken
 * predicate silent for the life of the process.
 */
export const resolveBotFilter = (option: boolean | BotFilter | undefined): BotFilter => {
	if (option === false) {
		return () => false
	}
	return typeof option === 'function' ? option : isBot
}
