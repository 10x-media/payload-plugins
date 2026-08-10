import { DefaultTemplate } from '@payloadcms/next/templates'
import { Button, Gutter, SetStepNav } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps, CollectionSlug } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { WikiEditModeToggle } from '../components/EditMode/WikiEditModeToggle'
import { WikiIndexClient } from '../components/WikiView/WikiIndexClient'
import {
	compareTargetEntries,
	targetKeysForDoc,
	type WikiTargetEntry,
	wikiTargetSelect,
} from '../shared/targetKeys'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { buildWikiViewContext, wikiLoginRedirectUrl } from './shared'

/**
 * `/admin/wiki`: the wiki index. Featured guides as cards, every published
 * guide in a flat searchable list. Reached from drawers and the wiki pages
 * list view; deliberately absent from the nav.
 */
export const WikiIndexView = async (props: AdminViewServerProps) => {
	const { i18n, initPageResult, params, payload, searchParams } = props
	const { permissions, req, visibleEntities } = initPageResult
	const context = buildWikiViewContext(props)
	if (!context) {
		return null
	}
	if (!req.user) {
		redirect(wikiLoginRedirectUrl(props, context.wikiPath))
	}
	const t = asTranslate(i18n.t)
	let entries: WikiTargetEntry[] = []
	try {
		const result = await payload.find({
			collection: context.registry.slugs.pages as CollectionSlug,
			depth: 0,
			draft: false,
			overrideAccess: false,
			pagination: false,
			req,
			select: {
				featured: true,
				featuredOrder: true,
				slug: true,
				summary: true,
				title: true,
				...wikiTargetSelect,
			},
			user: req.user,
			where: { _status: { equals: 'published' } },
			...(context.locale ? { fallbackLocale: context.fallbackLocale, locale: context.locale } : {}),
		})
		entries = (result.docs as Array<Record<string, unknown> & { id: number | string }>)
			.map((doc) => ({
				featured: doc.featured === true,
				featuredOrder: typeof doc.featuredOrder === 'number' ? doc.featuredOrder : null,
				id: doc.id,
				slug: typeof doc.slug === 'string' ? doc.slug : null,
				summary: typeof doc.summary === 'string' ? doc.summary : null,
				targetKeys: targetKeysForDoc(doc),
				title: typeof doc.title === 'string' ? doc.title : null,
			}))
			.sort(compareTargetEntries)
	} catch {
		entries = []
	}
	const createUrl = formatAdminURL({
		adminRoute: payload.config.routes.admin,
		path: `/collections/${context.registry.slugs.pages}/create`,
	})
	return (
		<DefaultTemplate
			i18n={i18n}
			locale={initPageResult.locale}
			params={params}
			payload={payload}
			permissions={permissions}
			req={req}
			searchParams={searchParams}
			user={req.user}
			viewActions={props.viewActions}
			visibleEntities={{
				collections: visibleEntities?.collections,
				globals: visibleEntities?.globals,
			}}
		>
			<Gutter className="wiki-view">
				<SetStepNav
					nav={[
						{
							label: t(keys.wikiViewTitle),
							url: context.wikiPath,
						},
					]}
				/>
				<header className="wiki-view__header">
					<div>
						<h1 className="wiki-view__title">{t(keys.wikiViewTitle)}</h1>
						<p className="wiki-view__subtitle">{t(keys.wikiSubtitle)}</p>
					</div>
					<div className="wiki-view__header-actions">
						<WikiEditModeToggle />
						{context.canCreate ? (
							<Button
								buttonStyle="pill"
								el="link"
								icon="plus"
								iconPosition="left"
								iconStyle="none"
								margin={false}
								size="small"
								to={createUrl}
							>
								{t(keys.wikiCreateGuide)}
							</Button>
						) : null}
					</div>
				</header>
				<WikiIndexClient baseUrl={context.wikiPath} entries={entries} />
			</Gutter>
		</DefaultTemplate>
	)
}
