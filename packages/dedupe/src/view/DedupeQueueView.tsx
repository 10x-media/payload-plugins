import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps, Params } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { isStatus, pageSize } from '../collections/slugs'
import { getContext, listCollections } from '../plugin/context'
import { readQueue } from '../queue/pairs'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { authRedirectUrl } from './authRedirect'
import { QueueClient } from './QueueClient'

export async function DedupeQueueView({
	initPageResult,
	params,
	searchParams,
	basePath,
}: AdminViewServerProps & { basePath: `/${string}` }) {
	const { req } = initPageResult
	const { user } = req
	const sp: Params = searchParams ?? {}
	const t = asTranslate(req.i18n.t)

	const ctx = getContext(req.payload)
	if (!user || !(await ctx.options.access.review({ req }))) {
		redirect(authRedirectUrl({ config: req.payload.config, params, searchParams: sp, user }))
	}

	const collections = listCollections(ctx, req.i18n)
	const param = (name: string) => [sp[name]].flat()[0]
	const requested = param('collection')
	const collection = collections.find((entry) => entry.slug === requested)?.slug ?? ''
	const requestedStatus = param('status')
	const status = isStatus(requestedStatus) ? requestedStatus : 'open'
	const limit = pageSize(param('limit'))
	const search = param('search') ?? ''
	const data = await readQueue({
		req,
		ctx,
		collection: collection || null,
		status,
		search,
		page: Number(param('page')) || 1,
		limit,
	})
	const adminRoute = req.payload.config.routes.admin
	const notFound = param('notFound')
	const notice = notFound
		? req.i18n.t('error:documentNotFound', { id: notFound })
		: param('missingPair')
			? t(keys.missingParams)
			: null

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
				{collections.length === 0 ? (
					<p>{t(keys.noCollections)}</p>
				) : (
					<QueueClient
						collection={collection}
						data={data}
						limit={limit}
						maxGroupSize={ctx.options.maxGroupSize}
						mergePath={formatAdminURL({ adminRoute, path: `${basePath}/merge` })}
						notice={notice}
						search={search}
						status={status}
					/>
				)}
			</Gutter>
		</DefaultTemplate>
	)
}
