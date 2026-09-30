import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'

import { ReportsStatus } from './ReportsStatus'

/**
 * A custom admin view at `/admin/reports`, standing for the `reports` custom
 * target: the banner here shows only windows covering it, and the page asks
 * the lock itself before offering to run anything.
 */
export const ReportsView = ({ initPageResult, params, searchParams }: AdminViewServerProps) => (
	<DefaultTemplate
		i18n={initPageResult.req.i18n}
		locale={initPageResult.locale}
		params={params}
		payload={initPageResult.req.payload}
		permissions={initPageResult.permissions}
		searchParams={searchParams}
		user={initPageResult.req.user ?? undefined}
		visibleEntities={initPageResult.visibleEntities}
	>
		<Gutter>
			<h1>Reports</h1>
			<ReportsStatus />
		</Gutter>
	</DefaultTemplate>
)
