import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps, Params } from 'payload'

import { getContext } from '../plugin/context'
import { authRedirectUrl } from './authRedirect'
import { DedupeQueue } from './DedupeQueue'

export async function DedupeQueueView({
	initPageResult,
	params,
	searchParams,
	basePath,
}: AdminViewServerProps & { basePath: `/${string}` }) {
	const { req } = initPageResult
	const { user } = req
	const sp: Params = searchParams ?? {}

	const ctx = getContext(req.payload)
	if (!user || !(await ctx.options.access.review({ req }))) {
		redirect(authRedirectUrl({ config: req.payload.config, params, searchParams: sp, user }))
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
			visibleEntities={initPageResult.visibleEntities}
			req={req}
		>
			<Gutter>
				<DedupeQueue basePath={basePath} req={req} searchParams={sp} />
			</Gutter>
		</DefaultTemplate>
	)
}
