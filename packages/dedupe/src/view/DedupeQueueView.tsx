import { DefaultTemplate } from '@payloadcms/ui/rsc'
import type { AdminViewServerProps, Params } from 'payload'

import { getContext } from '../plugin/context'
import { authRedirectUrl } from './authRedirect'
import { DedupeQueue } from './DedupeQueue'

export async function DedupeQueueView({
	initPageResult,
	params,
	searchParams,
	basePath,
	server,
	viewActions,
}: AdminViewServerProps & { basePath: `/${string}` }) {
	const { req } = initPageResult
	const { user } = req
	const sp: Params = searchParams ?? {}

	const ctx = getContext(req.payload)
	if (!user || !(await ctx.options.access.review({ req }))) {
		return server.redirect(
			authRedirectUrl({ config: req.payload.config, params, searchParams: sp, user })
		)
	}

	return (
		<DefaultTemplate
			i18n={req.i18n}
			locale={initPageResult.locale}
			params={params}
			payload={req.payload}
			permissions={initPageResult.permissions}
			searchParams={searchParams}
			user={user}
			viewActions={viewActions}
			visibleEntities={initPageResult.visibleEntities}
			req={req}
		>
			<DedupeQueue basePath={basePath} req={req} searchParams={sp} />
		</DefaultTemplate>
	)
}
