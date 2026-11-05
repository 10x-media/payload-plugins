import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import type { AdminViewServerProps, CollectionSlug, Params } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { getContext } from '../plugin/context'
import { authRedirectUrl } from './authRedirect'
import { MergeClient } from './MergeClient'

export async function DedupeMergeView({
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

	const param = (name: string) => [sp[name]].flat()[0]
	const list = (name: string) => (param(name) ?? '').split(',').filter(Boolean)
	const collection = param('collection')
	const survivor = param('survivor')
	const docs = list('docs')
	const adminRoute = req.payload.config.routes.admin
	// A link that names no group goes back to the queue, which says why.
	if (
		!collection ||
		!ctx.collections.has(collection) ||
		docs.length < 2 ||
		new Set(docs).size !== docs.length ||
		(survivor !== undefined && !docs.includes(survivor))
	) {
		return server.redirect(formatAdminURL({ adminRoute, path: `${basePath}?missingPair=1` }))
	}
	// As the admin does for a document that does not exist, is in the trash or the reader may not
	// read: back to the list of its collection, which names it.
	const found = await Promise.all(
		docs.map((id) =>
			req.payload.findByID({
				collection: collection as CollectionSlug,
				id,
				select: {},
				depth: 0,
				overrideAccess: false,
				user,
				req,
				disableErrors: true,
			})
		)
	)
	const missing = docs.find((_, index) => !found[index])
	if (missing) {
		const query = new URLSearchParams({ collection, notFound: missing })
		return server.redirect(formatAdminURL({ adminRoute, path: `${basePath}?${query}` }))
	}

	// Drawn here, so a section may be a server component, as any admin component may; what it
	// needs of the screen reaches it through `useMergeSection`.
	const sections = (ctx.collections.get(collection)?.options.sections ?? []).map((section) => ({
		key: section.key,
		node: RenderServerComponent({
			Component: section.Component,
			clientProps: { collection, sectionKey: section.key },
			importMap: req.payload.importMap,
			serverProps: { collection, payload: req.payload, req, sectionKey: section.key },
		}),
	}))

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
			{/* A new group in the address is a new screen, not new props for the one on it. */}
			<MergeClient
				collection={collection}
				key={`${collection}:${docs.join(',')}`}
				docs={docs as string[]}
				queuePath={formatAdminURL({ adminRoute, path: basePath })}
				sections={sections}
				survivor={survivor ?? (docs[0] as string)}
			/>
		</DefaultTemplate>
	)
}
