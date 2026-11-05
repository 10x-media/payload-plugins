import { addCalendarDays, calendarDayOf } from '../../timeframe/calendar'
import { DEFAULT_TIMEZONE } from '../../timeframe/tz'
import { bareHost } from '../ingest/referrer'
import type { EventStore } from '../store/types'
import { keepRecent } from './recent'

/** How many days back a scope's hostnames are read from its daily totals. */
const SITE_HOSTS_LOOKBACK_DAYS = 30

/** How long a scope's hostnames are used before its daily totals are read again. */
export const SITE_HOSTS_REFRESH_MS = 10 * 60_000

/** How many hostnames one scope keeps from this process's own hits beyond the stored ones. */
const MAX_SEEN_PER_SCOPE = 1_000

/**
 * Each scope's hostnames, so a link between two is a page of the site, not a referral: its last 30
 * days' totals reread every 10 minutes, plus those this process has stored hits under since.
 */
export interface SiteHosts {
	/** The scope's hostnames, bare (lowercased, no `www.`). */
	of(scope: string): Promise<ReadonlySet<string>>
	/** Notes a hostname the scope just stored a hit under. */
	saw(scope: string, hostname: string): void
}

interface Entry {
	stored: ReadonlySet<string>
	seen: Set<string>
	readAt: number
	reading: Promise<void> | null
}

export const createSiteHosts = (args: {
	store: Pick<EventStore, 'hostnames'>
	now: () => Date
	warn: (message: string) => void
}): SiteHosts => {
	const entries = new Map<string, Entry>()
	let warned = false

	const entryOf = (scope: string): Entry => {
		const entry: Entry = entries.get(scope) ?? {
			stored: new Set(),
			seen: new Set(),
			readAt: Number.NEGATIVE_INFINITY,
			reading: null,
		}
		keepRecent(entries, [scope, entry])
		return entry
	}

	const load = async (scope: string, entry: Entry): Promise<void> => {
		const now = args.now()
		const since = addCalendarDays(calendarDayOf(now, DEFAULT_TIMEZONE), -SITE_HOSTS_LOOKBACK_DAYS)
		try {
			entry.stored = new Set((await args.store.hostnames(scope, since)).map(bareHost))
		} catch (err) {
			if (!warned) {
				warned = true
				args.warn(
					`analytics: the hostnames a scope records hits under could not be read, so links between them may count as referrals until they can: ${String(err)}`
				)
			}
		}
		entry.readAt = now.getTime()
	}

	/** One read per scope at a time: concurrent beacons wait for the read already running. */
	const refresh = (scope: string, entry: Entry): Promise<void> => {
		if (entry.reading) {
			return entry.reading
		}
		const reading = load(scope, entry)
		entry.reading = reading
		void reading.finally(() => {
			if (entry.reading === reading) {
				entry.reading = null
			}
		})
		return reading
	}

	return {
		async of(scope) {
			const entry = entryOf(scope)
			if (args.now().getTime() - entry.readAt > SITE_HOSTS_REFRESH_MS) {
				await refresh(scope, entry)
			}
			return new Set([...entry.stored, ...entry.seen])
		},
		saw(scope, hostname) {
			const entry = entryOf(scope)
			const bare = bareHost(hostname)
			if (!entry.stored.has(bare) && entry.seen.size < MAX_SEEN_PER_SCOPE) {
				entry.seen.add(bare)
			}
		},
	}
}
