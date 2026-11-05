import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { chromium, devices } from '@playwright/test'

/**
 * Playwright's Chromium with no session attached: an attached DevTools client disables prerendering
 * and Playwright's focus emulation keeps every page visible, which the lifecycle checks need off.
 */
export interface DetachedChromium {
	/** The browser's CDP endpoint, for `chromium.connectOverCDP(wsEndpoint, { noDefaults: true })`. */
	wsEndpoint: string
	/**
	 * Opens a tab at `url` and brings it to the front, without attaching to it: Chromium prerenders
	 * nothing for a page in a background tab.
	 */
	open(url: string): Promise<void>
	/**
	 * Evaluates `expression` in the tab showing `pathname`, over a session that lasts this call
	 * alone, with a user gesture so a click it makes counts as the visitor's.
	 */
	evaluate(pathname: string, expression: string): Promise<unknown>
	/** The title of the tab showing `pathname`, read from the target list without attaching to it. */
	title(pathname: string): Promise<string | undefined>
	close(): Promise<void>
}

interface DevtoolsTarget {
	type: string
	url: string
	title: string
	webSocketDebuggerUrl: string
}

const isTarget = (value: unknown): value is DevtoolsTarget =>
	typeof value === 'object' &&
	value !== null &&
	'type' in value &&
	typeof value.type === 'string' &&
	'url' in value &&
	typeof value.url === 'string' &&
	'title' in value &&
	typeof value.title === 'string' &&
	'webSocketDebuggerUrl' in value &&
	typeof value.webSocketDebuggerUrl === 'string'

const endpointFrom = (process: ChildProcessByStdio<null, null, Readable>): Promise<string> =>
	new Promise((resolve, reject) => {
		let output = ''
		const timer = setTimeout(() => reject(new Error(`Chromium did not start:\n${output}`)), 30_000)
		process.stderr.on('data', (chunk: Buffer) => {
			output += chunk.toString()
			const match = /DevTools listening on (ws:\/\/\S+)/.exec(output)
			if (match?.[1]) {
				clearTimeout(timer)
				resolve(match[1])
			}
		})
		process.once('exit', (code) => {
			clearTimeout(timer)
			reject(new Error(`Chromium exited with ${code}:\n${output}`))
		})
	})

/** One CDP call over a page's own socket, closed once it answers. */
const evaluateOver = async (socketUrl: string, expression: string): Promise<unknown> => {
	const socket = new WebSocket(socketUrl)
	await once(socket, 'open')
	try {
		const answer = new Promise<unknown>((resolve, reject) => {
			socket.addEventListener('message', (event) => {
				const message: unknown = JSON.parse(String(event.data))
				if (typeof message !== 'object' || message === null || !('id' in message)) {
					return
				}
				if ('error' in message) {
					reject(new Error(JSON.stringify(message.error)))
					return
				}
				const result = 'result' in message ? message.result : undefined
				const remote =
					typeof result === 'object' && result !== null && 'result' in result
						? result.result
						: undefined
				resolve(
					typeof remote === 'object' && remote !== null && 'value' in remote
						? remote.value
						: undefined
				)
			})
		})
		socket.send(
			JSON.stringify({
				id: 1,
				method: 'Runtime.evaluate',
				params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
			})
		)
		return await answer
	} finally {
		socket.close()
	}
}

export const launchDetachedChromium = async (): Promise<DetachedChromium> => {
	const profile = await mkdtemp(join(tmpdir(), 'analytics-e2e-chromium-'))
	const userAgent = devices['Desktop Chrome'].userAgent
	const browser = spawn(
		chromium.executablePath(),
		[
			'--headless=new',
			// What Playwright passes too: CI runners refuse Chromium's sandbox.
			'--no-sandbox',
			'--no-first-run',
			'--no-default-browser-check',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`,
			// The headless build names itself HeadlessChrome, which native ingest drops as a bot.
			`--user-agent=${userAgent}`,
			'about:blank',
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	)
	const wsEndpoint = await endpointFrom(browser)
	const http = `http://${new URL(wsEndpoint).host}`

	const targets = async (): Promise<DevtoolsTarget[]> => {
		const listed: unknown = await (await fetch(`${http}/json/list`)).json()
		return Array.isArray(listed) ? listed.filter(isTarget) : []
	}

	const tabShowing = async (pathname: string): Promise<DevtoolsTarget | undefined> =>
		(await targets()).find(
			(each) =>
				each.type === 'page' && URL.canParse(each.url) && new URL(each.url).pathname === pathname
		)

	return {
		wsEndpoint,
		async open(url) {
			const res = await fetch(`${http}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
			const opened: unknown = res.ok ? await res.json() : undefined
			const id =
				typeof opened === 'object' &&
				opened !== null &&
				'id' in opened &&
				typeof opened.id === 'string'
					? opened.id
					: undefined
			if (id === undefined) {
				throw new Error(`could not open ${url}: ${res.status}`)
			}
			const front = await fetch(`${http}/json/activate/${id}`)
			if (!front.ok) {
				throw new Error(`could not bring ${url} to the front: ${front.status}`)
			}
		},
		async evaluate(pathname, expression) {
			const target = await tabShowing(pathname)
			if (!target) {
				throw new Error(`no tab shows ${pathname}`)
			}
			return evaluateOver(target.webSocketDebuggerUrl, expression)
		},
		async title(pathname) {
			return (await tabShowing(pathname))?.title
		},
		async close() {
			if (browser.exitCode === null) {
				const exited = once(browser, 'exit')
				browser.kill()
				await exited
			}
			await rm(profile, { recursive: true, force: true, maxRetries: 5 })
		},
	}
}
