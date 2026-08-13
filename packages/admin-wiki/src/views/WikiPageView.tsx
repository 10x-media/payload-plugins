import { DefaultTemplate } from '@payloadcms/next/templates'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { Gutter, SetStepNav } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps, CollectionSlug } from 'payload'
import { formatAdminURL } from 'payload/shared'

import { GuideArticle } from '../components/GuideArticle/GuideArticle'
import { StarIcon } from '../components/icons'
import { TargetChips } from '../components/TargetChips/TargetChips'
import { WikiToc } from '../components/Toc/WikiToc'
import { WikiViewActions } from '../components/WikiView/WikiViewActions'
import { collectGuideHeadings, hasTocHeadings } from '../shared/headings'
import { targetKeysForDoc, type WikiGuideDoc, type WikiTargetDoc } from '../shared/targetKeys'
import { chipTargetKeys } from '../shared/targetLabels'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { buildWikiViewContext, wikiLoginRedirectUrl } from './shared'

/**
 * `/admin/wiki/<slug>`: the full reading view for one published guide,
 * rendered with the same `GuideArticle` component the drawers use.
 */
export const WikiPageView = async (props: AdminViewServerProps) => {
	const { i18n, initPageResult, params, payload, searchParams } = props
	const { permissions, req, visibleEntities } = initPageResult
	const context = buildWikiViewContext(props)
	if (!context) {
		return null
	}
	const segments = Array.isArray(params?.segments) ? params.segments : []
	const slug = typeof segments[1] === 'string' ? decodeURIComponent(segments[1]) : ''
	if (!req.user) {
		redirect(wikiLoginRedirectUrl(props, slug ? `${context.wikiPath}/${slug}` : context.wikiPath))
	}
	const t = asTranslate(i18n.t)
	let doc: null | (WikiGuideDoc & WikiTargetDoc & { featured?: unknown }) = null
	if (slug) {
		try {
			const result = await payload.find({
				collection: context.registry.slugs.pages as CollectionSlug,
				depth: 1,
				draft: false,
				limit: 1,
				overrideAccess: false,
				req,
				user: req.user,
				where: {
					and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }],
				},
				...(context.locale
					? { fallbackLocale: context.fallbackLocale, locale: context.locale }
					: {}),
			})
			doc =
				(result.docs[0] as undefined | (WikiGuideDoc & WikiTargetDoc & { featured?: unknown })) ??
				null
		} catch (error) {
			// A missing guide and a failed query both render "not found", so the
			// difference is only recoverable from the log.
			payload.logger.error(error, `@10x-media/admin-wiki: failed to load guide "${slug}"`)
			doc = null
		}
	}
	const content = doc?.content as SerializedEditorState | null | undefined
	const editUrl = doc
		? formatAdminURL({
				adminRoute: payload.config.routes.admin,
				path: `/collections/${context.registry.slugs.pages}/${doc.id}`,
			})
		: null
	const targetKeys = chipTargetKeys(targetKeysForDoc(doc))
	const { headings } = collectGuideHeadings(content)
	const showToc = hasTocHeadings(headings)
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
			<Gutter className="wiki-view wiki-view--page">
				<SetStepNav
					nav={[
						{
							label: t(keys.wikiViewTitle),
							url: context.wikiPath,
						},
						// A missing guide has no crumb of its own: the fallbacks produced an
						// empty label pointing at `/wiki/undefined`.
						...(doc
							? [
									{
										label: doc.title ?? '',
										url: `${context.wikiPath}/${encodeURIComponent(doc.slug ?? '')}`,
									},
								]
							: []),
					]}
				/>
				{doc && context.canUpdate && editUrl ? <WikiViewActions editUrl={editUrl} /> : null}
				<div
					className={['wiki-guide-layout', showToc ? 'wiki-guide-layout--with-toc' : null]
						.filter(Boolean)
						.join(' ')}
				>
					{doc ? (
						<article className="wiki-view__article">
							<header className="wiki-view__article-header">
								<h1 className="wiki-view__article-title">
									{doc.title}
									{doc.featured === true ? <StarIcon /> : null}
								</h1>
								{doc.summary ? <p className="wiki-view__summary">{doc.summary}</p> : null}
								{targetKeys.length > 0 ? (
									<div className="wiki-view__article-targets">
										<span className="wiki-view__article-targets-label">
											{t(keys.targetsHeading)}
										</span>
										<TargetChips limit={8} targetKeys={targetKeys} />
									</div>
								) : null}
							</header>
							{content ? <GuideArticle data={content} /> : null}
						</article>
					) : (
						<p className="wiki-view__status">{t(keys.wikiGuideNotFound)}</p>
					)}
					{showToc ? <WikiToc headings={headings} /> : null}
				</div>
			</Gutter>
		</DefaultTemplate>
	)
}
