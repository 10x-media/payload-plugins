import { hostname } from 'node:os'

/**
 * A stable-per-process identity for job claims and leadership. An explicit
 * `leaderId` wins; otherwise derive `hostname:pid`, which is stable within a process
 * and distinguishes nodes in a cluster.
 */
export const resolveNodeId = (leaderId: string | null): string =>
	leaderId ?? `${hostname()}:${process.pid}`
