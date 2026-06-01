import type { Field } from 'payload'

/**
 * Fields added to the built-in `payload-jobs` collection (via jobsCollectionOverrides)
 * when reliability is enabled. `leaseExpiresAt` is the liveness signal renewed by the
 * worker heartbeat; the sweeper reclaims a job when `leaseExpiresAt < now`. All are
 * sidebar, read-only-in-admin diagnostics (the runtime, not a human, writes them).
 */
export const reliabilityJobFields = (): Field[] => [
	{
		name: 'startedAt',
		type: 'date',
		admin: { position: 'sidebar', readOnly: true },
		index: true,
	},
	{
		name: 'leaseExpiresAt',
		type: 'date',
		admin: { position: 'sidebar', readOnly: true },
		index: true,
	},
	{
		name: 'claimedBy',
		type: 'text',
		admin: { position: 'sidebar', readOnly: true },
		index: true,
	},
	{
		name: 'fenceToken',
		type: 'number',
		admin: { position: 'sidebar', readOnly: true },
	},
	{
		name: 'recoveryAttempts',
		type: 'number',
		admin: { position: 'sidebar', readOnly: true },
		defaultValue: 0,
	},
]
