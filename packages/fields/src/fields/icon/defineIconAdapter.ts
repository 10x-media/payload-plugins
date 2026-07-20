import type { IconAdapter } from '../../types'

/** Identity helper for BYO libraries; pins the adapter contract version. */
export const defineIconAdapter = (adapter: Omit<IconAdapter, 'version'>): IconAdapter => ({
	...adapter,
	version: 1,
})
