import type { TrackerWindow } from './types'

/** The window a tracker call runs against: the one given, else the global one, absent on a server. */
export const currentWindow = (given?: TrackerWindow): TrackerWindow | undefined =>
	given ?? (typeof window === 'undefined' ? undefined : window)
