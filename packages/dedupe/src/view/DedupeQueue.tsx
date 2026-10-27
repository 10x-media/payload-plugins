import type { Params, PayloadRequest } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { isStatus, type PairStatus, pageSize } from '../collections/slugs'
import { getContext, listCollections } from '../plugin/context'
import { readQueue } from '../queue/pairs'
import { pendingScans } from '../queue/scanJobs'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { QueueClient } from './QueueClient'

/** The queue's filter and page as the URL gives them, unknown values dropped. */
export const queueParams = (
	searchParams: Params,
	collections: { slug: string }[]
): { collection: string; limit: number; page: number; search: string; status: PairStatus } => {
	const param = (name: string) => [searchParams[name]].flat()[0]
	const requested = param('collection')
	const status = param('status')
	return {
		collection: collections.find((entry) => entry.slug === requested)?.slug ?? '',
		limit: pageSize(param('limit')),
		page: Number(param('page')) || 1,
		search: param('search') ?? '',
		status: isStatus(status) ? status : 'open',
	}
}

/**
 * The queue without a page around it: its heading, tabs, search, table and pagination. For a
 * host that draws the queue's page itself (`view.queue: false`); `DedupeQueueView` is this in
 * Payload's template. Filters and paging live in the URL of the page it is on. Renders nothing
 * for a reader `access.review` refuses, or when `view` is `false`, as the merge screen it links
 * to is then missing.
 */
export async function DedupeQueue({
	req,
	searchParams,
}: {
	req: PayloadRequest
	searchParams?: Params
}) {
	const sp: Params = searchParams ?? {}
	const t = asTranslate(req.i18n.t)
	const ctx = getContext(req.payload)
	const { view } = ctx.options
	if (!view || !req.user || !(await ctx.options.access.review({ req }))) return null

	const collections = listCollections(ctx, req.i18n)
	if (collections.length === 0) return <p>{t(keys.noCollections)}</p>

	const { collection, limit, page, search, status } = queueParams(sp, collections)
	const data = await readQueue({
		req,
		ctx,
		collection: collection || null,
		status,
		search,
		page,
		limit,
	})
	const mayScan = await ctx.options.access.scan({ req })
	const scanned = collection
		? [collection]
		: collections.filter((entry) => entry.hasMatch).map((entry) => entry.slug)
	const pending =
		mayScan && !ctx.options.disableJobsQueue
			? await pendingScans({ req, collections: scanned })
			: new Map()
	// Pending only once every collection the button scans has a scan waiting or running.
	const scanState =
		scanned.length > 0 && scanned.every((slug) => pending.has(slug))
			? [...pending.values()].some((scan) => scan.running)
				? 'running'
				: 'queued'
			: null
	const notFound = [sp.notFound].flat()[0]
	const notice = notFound
		? req.i18n.t('error:documentNotFound', { id: notFound })
		: [sp.missingPair].flat()[0]
			? t(keys.missingParams)
			: null

	return (
		<QueueClient
			collection={collection}
			data={data}
			limit={limit}
			maxGroupSize={ctx.options.maxGroupSize}
			mayScan={Boolean(mayScan)}
			scanState={scanState}
			mergePath={formatAdminURL({
				adminRoute: req.payload.config.routes.admin,
				path: `${view.path}/merge`,
			})}
			notice={notice}
			search={search}
			status={status}
		/>
	)
}
