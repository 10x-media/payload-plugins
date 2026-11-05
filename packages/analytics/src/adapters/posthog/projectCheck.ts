import type { FetchLike } from '../../core/fetch'
import { isRecord } from '../../core/values'
import { fetchJson } from '../http/fetchJson'

/** How long one answer about the project's setting is trusted. */
export const PROJECT_CHECK_TTL_MS = 60 * 60 * 1000

/** How long a failed check waits before the next read asks again. */
export const PROJECT_CHECK_RETRY_MS = 5 * 60 * 1000

/** A slow settings endpoint holds up the read that asked, so it gets little time. */
const PROJECT_CHECK_TIMEOUT_MS = 5_000

export interface ProjectCheckOptions {
	host: string
	projectId: string
	apiKey: string
	fetch?: FetchLike
}

/**
 * Whether the project drops events counted without consent: true when its cookieless tracking
 * setting is off, undefined when that could not be read (a key without `project:read`, an outage).
 */
export type ProjectCheck = (now: number) => Promise<boolean | undefined>

/**
 * PostHog's `cookieless_server_hash_mode` (0 or null off, 1 and 2 on) as whether events are
 * dropped; anything else, such as an instance too old to have the field, is unknown.
 */
const dropsCookieless = (project: unknown): boolean | undefined => {
	if (!isRecord(project)) {
		return undefined
	}
	const mode = project.cookieless_server_hash_mode
	if (mode === null || mode === 0) {
		return true
	}
	return typeof mode === 'number' ? false : undefined
}

interface ProjectCheckEntry {
	at: number
	ttl: number
	answer: Promise<boolean | undefined>
}

/**
 * Answers by host and project, shared by every adapter reading the project: `providers.resolve`
 * builds a new adapter per read, which would otherwise ask again each time.
 */
const checks = new Map<string, ProjectCheckEntry>()

/** Forgets every remembered answer, for tests that reuse one project. */
export const forgetProjectChecks = (): void => {
	checks.clear()
}

/**
 * Reads the project's settings (`GET /api/projects/:id/`) with the personal API key, memoized per
 * host and project: one request an hour at most, and a failure is remembered for a few minutes
 * rather than thrown.
 */
export const createProjectCheck = (options: ProjectCheckOptions): ProjectCheck => {
	const key = `${options.host}\n${options.projectId}`
	return (now) => {
		const memo = checks.get(key)
		if (memo && now - memo.at < memo.ttl) {
			return memo.answer
		}
		const entry: ProjectCheckEntry = {
			at: now,
			ttl: PROJECT_CHECK_TTL_MS,
			answer: Promise.resolve<boolean | undefined>(undefined),
		}
		// Not the read's own signal: one aborted read would otherwise hush the check for everyone.
		entry.answer = fetchJson<unknown>(
			`${options.host}/api/projects/${encodeURIComponent(options.projectId)}/`,
			{
				method: 'GET',
				headers: { authorization: `Bearer ${options.apiKey}` },
				provider: 'posthog',
				signal: AbortSignal.timeout(PROJECT_CHECK_TIMEOUT_MS),
				...(options.fetch ? { fetch: options.fetch } : {}),
			}
		).then(dropsCookieless, () => {
			entry.ttl = PROJECT_CHECK_RETRY_MS
			return undefined
		})
		checks.set(key, entry)
		return entry.answer
	}
}
