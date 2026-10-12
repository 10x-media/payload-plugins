import { getCurrentDate } from 'payload'

/**
 * What time it is for every server-side read: Payload's own clock, so a test that sets it moves
 * every day cut, lease and cache stamp at once. Durations run on `monotonicMs`.
 */
export const currentDate = (): Date => getCurrentDate()

/** {@link currentDate} in epoch milliseconds. */
export const currentTime = (): number => getCurrentDate().getTime()
