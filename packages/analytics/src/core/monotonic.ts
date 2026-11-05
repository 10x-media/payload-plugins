/**
 * Milliseconds on a clock that only moves forward, which every duration, deadline, budget and rate
 * limit is timed on, on the server and in the browser alike. It says nothing about what time it is.
 */
export const monotonicMs = (): number => performance.now()
