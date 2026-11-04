import { Button, SetStepNav } from '@payloadcms/ui'
import { ListHeader } from '@payloadcms/ui/elements/ListHeader'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import type { AdminViewServerProps, CollectionSlug } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { Fragment, type ReactNode } from 'react'

import { WikiEditModeToggle } from '../components/EditMode/WikiEditModeToggle'
import { WikiIndexClient } from '../components/WikiView/WikiIndexClient'
import type { WikiViewSlot, WikiViewSlotClientProps, WikiViewSlotServerProps } from '../options'
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
		props.server.redirect(wikiLoginRedirectUrl(props, context.wikiPath))
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
	} catch (error) {
		// An empty index and a failed query look identical to the reader, so the
		// difference is only recoverable from the log.
		payload.logger.error(error, '@10x-media/admin-wiki: failed to load the wiki index')
		entries = []
	}
	const createUrl = formatAdminURL({
		adminRoute: payload.config.routes.admin,
		path: `/collections/${context.registry.slugs.pages}/create`,
	})
	/**
	 * A slot's components, or null when it holds none, so the callers can leave
	 * their wrapper out entirely rather than spacing an empty element.
	 */
	const renderSlot = (slot: WikiViewSlot): null | ReactNode => {
		const components = context.slots[slot]
		if (components.length === 0) {
			return null
		}
		const clientProps: WikiViewSlotClientProps = {
			canCreate: context.canCreate,
			guideCount: entries.length,
			slot,
			wikiPath: context.wikiPath,
		}
		const serverProps: WikiViewSlotServerProps = {
			i18n,
			locale: context.locale,
			params,
			payload,
			req,
			searchParams,
		}
		return RenderServerComponent({
			clientProps,
			Component: components,
			importMap: payload.importMap,
			serverProps,
		})
	}
	const beforeControls = renderSlot('beforeControls')
	return (
		<DefaultTemplate
			i18n={i18n}
			locale={initPageResult.locale}
			params={params}
			payload={payload}
			permissions={permissions}
			req={req}
			searchParams={searchParams}
			user={props.user}
			viewActions={props.viewActions}
			visibleEntities={{
				collections: visibleEntities?.collections,
				globals: visibleEntities?.globals,
			}}
		>
			<div className="wiki-view">
				<SetStepNav
					nav={[
						{
							label: t(keys.wikiViewTitle),
							url: context.wikiPath,
						},
					]}
				/>
				<ListHeader
					Actions={[
						beforeControls ? <Fragment key="before-controls">{beforeControls}</Fragment> : null,
						<WikiEditModeToggle key="edit-mode" />,
						context.canCreate ? (
							<Button
								buttonStyle="pill"
								el="link"
								icon="plus"
								iconPosition="left"
								key="create"
								margin={false}
								size="medium"
								to={createUrl}
							>
								{t(keys.wikiCreateGuide)}
							</Button>
						) : null,
					].filter(Boolean)}
					AfterListHeaderContent={<p className="wiki-view__subtitle">{t(keys.wikiSubtitle)}</p>}
					className="wiki-view__header"
					title={t(keys.wikiViewTitle)}
				/>
				<WikiIndexClient
					afterTable={renderSlot('afterTable')}
					baseUrl={context.wikiPath}
					beforeTable={renderSlot('beforeTable')}
					entries={entries}
				/>
			</div>
		</DefaultTemplate>
	)
}
