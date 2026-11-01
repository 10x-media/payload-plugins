import type { PayloadRequest } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { isStatus, pageSize } from '../collections/slugs'
import { getContext, listCollections } from '../plugin/context'
import { readQueue } from '../queue/readQueue'
import { pendingScans } from '../queue/scanJobs'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { QueueClient } from './QueueClient'

/**
 * The queue without a page around it, for a host that draws its own page (`view.queue: false`):
 * `DedupeQueueView` is this inside Payload's default template. Filters and paging live in the
 * URL of whatever page it is on. Renders nothing for a reader the `review` access refuses; the
 * host page decides what such a reader sees instead.
 */
export async function DedupeQueue({
	req,
	searchParams,
	basePath,
}: {
	req: PayloadRequest
	searchParams?: Record<string, string | string[] | undefined>
	/** Where the merge screen is mounted below: the plugin's `view.path`. */
	basePath: `/${string}`
}) {
	const sp = searchParams ?? {}
	const t = asTranslate(req.i18n.t)
	const ctx = getContext(req.payload)
	if (!req.user || !(await ctx.options.access.review({ req }))) return null

	const collections = listCollections(ctx, req.i18n)
	if (collections.length === 0) return <p>{t(keys.noCollections)}</p>
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
	const adminRoute = req.payload.config.routes.admin
	const notFound = param('notFound')
	const notice = notFound
		? req.i18n.t('error:documentNotFound', { id: notFound })
		: param('missingPair')
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
			mergePath={formatAdminURL({ adminRoute, path: `${basePath}/merge` })}
			notice={notice}
			search={search}
			status={status}
		/>
	)
}
