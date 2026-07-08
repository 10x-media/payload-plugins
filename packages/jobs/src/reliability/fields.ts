import type { Field } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const READONLY_DATE = '@10x-media/jobs/client#ReadOnlyDateField'
const RELATIVE_CELL = '@10x-media/jobs/client#RelativeTimeCell'

/**
 * Fields added to the built-in `payload-jobs` collection (via jobsCollectionOverrides)
 * when reliability is enabled. `leaseExpiresAt` is the liveness signal renewed by the
 * worker heartbeat; the sweeper reclaims a job when `leaseExpiresAt < now`. All are
 * sidebar, read-only-in-admin diagnostics (the runtime, not a human, writes them).
 * `startedAt`/`leaseExpiresAt` get the read-only relative-time Field and list Cell
 * directly, since these fields are appended after the enhancement pass runs.
 */
export const reliabilityJobFields = (): Field[] => [
	{
		name: 'startedAt',
		type: 'date',
		label: labelForKey(keys.fieldStarted),
		admin: {
			position: 'sidebar',
			readOnly: true,
			components: { Cell: RELATIVE_CELL, Field: READONLY_DATE },
		},
		index: true,
	},
	{
		name: 'leaseExpiresAt',
		type: 'date',
		label: labelForKey(keys.fieldLeaseExpires),
		admin: {
			position: 'sidebar',
			readOnly: true,
			components: { Cell: RELATIVE_CELL, Field: READONLY_DATE },
		},
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
