import type { CollectionConfig } from 'payload'
import { GOAL_ACTION_TYPE, trackGoalAction } from '../../src/goals/trackGoalAction'

export const ACTION_HOST_SLUG = 'action-host'

/**
 * Stand-in for form-builder's action blocks: booting it proves the action's config survives
 * Payload's sanitization under its type as block slug (and gets a usable Postgres table name).
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
