import { Gutter } from '@payloadcms/ui'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import type { AdminViewServerProps } from 'payload'

import { ReportsStatus } from './ReportsStatus'

/**
 * A custom admin view at `/admin/reports`, standing for the `reports` custom
 * target: the banner here shows only windows covering it, and the page asks
 * the lock itself before offering to run anything.
 */
export const ReportsView = (props: AdminViewServerProps) => {
	const { initPageResult, params, searchParams } = props
	return (
		<DefaultTemplate
			i18n={initPageResult.req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={initPageResult.req.payload}
			permissions={initPageResult.permissions}
			req={initPageResult.req}
			searchParams={searchParams}
			user={props.user}
			viewActions={props.viewActions}
			visibleEntities={initPageResult.visibleEntities}
		>
			<Gutter className="dev-reports-view">
				<h1
					style={{
						fontSize: 'var(--text-heading-xl-font-size)',
						fontWeight: 'var(--text-heading-xl-font-weight)',
						lineHeight: 'var(--text-heading-xl-line-height)',
					}}
				>
					Reports
				</h1>
				<ReportsStatus />
			</Gutter>
		</DefaultTemplate>
	)
}
