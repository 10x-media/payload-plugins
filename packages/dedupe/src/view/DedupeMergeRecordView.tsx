import { DefaultTemplate } from '@payloadcms/next/templates'
import { notFound, redirect } from 'next/navigation'
import { type AdminViewServerProps, APIError, type Params } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { readMergeRecord } from '../merge/record'
import { getContext } from '../plugin/context'
import { authRedirectUrl } from './authRedirect'
import { MergeRecordClient } from './MergeRecordClient'

export async function DedupeMergeRecordView({
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

	const id = [params?.segments].flat().at(-1) ?? ''
	// A record that is not there, or not the reader's to see, answers as a document does: not found.
	const record = await readMergeRecord({ req, ctx, id }).catch((err: unknown) => {
		if (err instanceof APIError) notFound()
		throw err
	})
	const queuePath = formatAdminURL({ adminRoute: req.payload.config.routes.admin, path: basePath })

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
			<MergeRecordClient queuePath={queuePath} record={record} />
		</DefaultTemplate>
	)
}
