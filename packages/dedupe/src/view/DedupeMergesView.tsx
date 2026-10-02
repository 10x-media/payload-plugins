import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps, Params } from 'payload'

import { pageSize } from '../collections/slugs'
import { readMerges } from '../merge/record'
import { getContext } from '../plugin/context'
import { authRedirectUrl } from './authRedirect'
import { MergesClient } from './MergesClient'

export async function DedupeMergesView({
	initPageResult,
	params,
	searchParams,
}: AdminViewServerProps) {
	const { req } = initPageResult
	const { user } = req
	const sp: Params = searchParams ?? {}

	const ctx = getContext(req.payload)
	if (!user || !(await ctx.options.access.review({ req }))) {
		redirect(authRedirectUrl({ config: req.payload.config, params, searchParams: sp, user }))
	}

	const param = (name: string) => [sp[name]].flat()[0]
	const limit = pageSize(param('limit'))
	const data = await readMerges({
		req,
		ctx,
		collection: param('collection') ?? null,
		page: Number(param('page')) || 1,
		limit,
	})

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
				<MergesClient data={data} limit={limit} />
			</Gutter>
		</DefaultTemplate>
	)
}
