import type { ServerProps } from 'payload'

import { viewerTargetFilters } from '../access/viewerTargetFilters'
import { viewerKey } from '../ids'
import { ImpersonationTargetsSync } from './ImpersonationConfig'

/**
 * Header slot, rendered by the admin template on every page, so it follows navigation. Feeds the
 * provider the signed-in viewer's target filters and renders nothing visible.
 */
export const ImpersonationTargetsHeader = async ({ i18n, payload, user }: ServerProps) => {
	return (
		<ImpersonationTargetsSync
			targetFilters={await viewerTargetFilters(user, i18n, payload)}
			viewer={viewerKey(user)}
		/>
	)
}
