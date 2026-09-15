import type { CollectionConfig } from 'payload'
import { GOAL_ACTION_TYPE, trackGoalAction } from '../../src/goals/trackGoalAction'

export const ACTION_HOST_SLUG = 'action-host'

/**
 * A stand-in for the form collection form-builder builds from its action registry: one
 * `blocks` field whose only block carries this action's own type as its slug and its config
 * as its fields. Booting it proves the config survives Payload's sanitization under that
 * slug (the goal picker's custom Field component, the number `min`, the currency
 * `validate`), which on Postgres also means the block gets a usable table name.
 */
export const actionHost = (): CollectionConfig => ({
	slug: ACTION_HOST_SLUG,
	fields: [
		{
			name: 'actions',
			type: 'blocks',
			blocks: [{ slug: GOAL_ACTION_TYPE, fields: trackGoalAction().config }],
		},
	],
})
