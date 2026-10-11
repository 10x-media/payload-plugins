import type { PayloadRequest } from 'payload'
import type { TimezoneResolver } from '../core/options'
import { DEFAULT_TIMEZONE, isValidTimeZone } from './tz'

/** A resolver can answer from request data, so the values it is warned about are capped. */
const MAX_WARNED_ZONES = 100

/** A resolver's answer as a log line quotes it, cut short so a caller cannot inflate the line. */
const quoted = (answer: string): string => JSON.stringify(answer.slice(0, 64))

interface ReportingTimezoneArgs {
	/** `reportingTimezone`; a string was already validated at boot. */
	option: string | TimezoneResolver | undefined
	resolveScope: (req: PayloadRequest) => Promise<string | null>
}

/** A request's reporting timezone, for the scope the caller resolved or the request's own. */
type RequestTimezoneResolver = (req: PayloadRequest, scope?: string | null) => Promise<string>

/** The host's `reportingTimezone` resolver threw, or answered something that is not a zone. */
export class TimezoneResolutionError extends Error {
	/** What the resolver answered, when it answered a name that is not an IANA zone. */
	readonly answer: string | undefined

	constructor(message: string, answer?: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'TimezoneResolutionError'
		this.answer = answer
	}
}

/**
 * Throws a {@link TimezoneResolutionError} instead of falling back to UTC: the native engine counts
 * stored days in this zone, so one UTC day would move its numbers. `null` is UTC.
 */
export const createStrictTimezoneResolver =
	(args: ReportingTimezoneArgs): RequestTimezoneResolver =>
	async (req, scope) => {
		const { option } = args
		if (option === undefined) {
			return DEFAULT_TIMEZONE
		}
		if (typeof option === 'string') {
			return option
		}
		let tz: string | null
		try {
			tz = await option({
				req,
				scope: scope !== undefined ? scope : await args.resolveScope(req),
			})
		} catch (err) {
			throw new TimezoneResolutionError(
				`analytics: reportingTimezone resolution failed: ${String(err)}`,
				undefined,
				err
			)
		}
		if (!tz) {
			return DEFAULT_TIMEZONE
		}
		if (!isValidTimeZone(tz)) {
			throw new TimezoneResolutionError(
				`analytics: reportingTimezone resolved ${quoted(tz)}, which is not an IANA timezone name`,
				tz
			)
		}
		return tz
	}

/**
 * Reporting timezone for display and provider reads, bound once per plugin instance. A throw or a
 * non-IANA answer reads in UTC, the latter warned once per distinct value.
 */
export const createTimezoneResolver = (args: ReportingTimezoneArgs): RequestTimezoneResolver => {
	const strict = createStrictTimezoneResolver(args)
	const warned = new Set<string>()
	return async (req, scope) => {
		try {
			return await strict(req, scope)
		} catch (err) {
			const answer = err instanceof TimezoneResolutionError ? err.answer : undefined
			if (answer === undefined) {
				const cause = err instanceof TimezoneResolutionError ? err.cause : err
				req.payload?.logger?.warn?.(
					`analytics: reportingTimezone resolution failed, falling back to UTC: ${String(cause)}`
				)
			} else if (!warned.has(answer) && warned.size < MAX_WARNED_ZONES) {
				warned.add(answer)
				req.payload?.logger?.warn?.(
					`analytics: reportingTimezone resolved ${quoted(answer)}, which is not an IANA timezone name, so the read is in UTC`
				)
			}
			return DEFAULT_TIMEZONE
		}
	}
}
