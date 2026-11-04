import type { Field } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const READONLY_DATE = '@10x-media/jobs/client#ReadOnlyDateField'
const RELATIVE_CELL = '@10x-media/jobs/client#RelativeTimeCell'

/**
 * Fields added to the built-in `payload-jobs` collection (via jobsCollectionOverrides)
 * when reliability is enabled. The recovery layer writes them around every run:
 * `claimedBy` names the node running the job and is cleared when the handler
 * returns, so a claim that finds it set follows a run that died (see
 * `withRecovery`). All are sidebar, read-only-in-admin diagnostics. `startedAt`
 * gets the read-only relative-time Field and list Cell directly, since these
 * fields are appended after the enhancement pass runs.
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
		name: 'claimedBy',
		type: 'text',
		admin: { position: 'sidebar', readOnly: true },
		index: true,
	},
	{
		name: 'recoveryAttempts',
		type: 'number',
		admin: { position: 'sidebar', readOnly: true },
		defaultValue: 0,
	},
]
