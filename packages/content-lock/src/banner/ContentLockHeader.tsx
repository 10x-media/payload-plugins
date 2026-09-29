import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { type JSXConvertersFunction, RichText } from '@payloadcms/richtext-lexical/react'
import { getTranslation, type I18nClient } from '@payloadcms/translations'
import type { CollectionSlug, Payload, SelectType, ServerProps, TypedLocale } from 'payload'

import { optionsFromConfig, type ResolvedOptions } from '../options'
import { customTargetsAt } from '../state/customTargets'
import { namedTargets, orderBanners, scopeOf } from '../state/resolve'
import { getContentLockState } from '../state/store'
import type { EntityRef, LockWindow, ResolvedScope } from '../state/types'
import { type BannerItem, ContentLockBanner } from './ContentLockBanner'
import { ContentLockStateSync } from './ContentLockProvider'
import { languageForLocale, resolveMessageLocale } from './locale'
import { buildMessageConverters, composeConverters } from './messageConverters'

type HeaderProps = ServerProps & { collectionSlug?: string; globalSlug?: string }

/** The admin page's path below the admin route, from the catch-all segments. */
const adminPath = (params: unknown): string => {
	const segments = (params as { segments?: unknown } | undefined)?.segments
	return Array.isArray(segments) ? `/${segments.map(String).join('/')}` : '/'
}

/** Labels of a window's scope for the viewer, or `null` when it freezes everything. */
const scopeLabels = ({
	scope,
	window,
	payload,
	i18n,
	options,
}: {
	scope: ResolvedScope
	window: LockWindow
	payload: Payload
	i18n: I18nClient
	options: ResolvedOptions
}): string[] | null => {
	if (scope.everything) {
		return null
	}
	const labels: string[] = []
	for (const target of namedTargets(window.targets, options.groups)) {
		const separator = target.indexOf(':')
		const kind = target.slice(0, separator)
		const slug = target.slice(separator + 1)
		if (kind === 'group') {
			const group = options.groups.find((candidate) => candidate.key === slug)
			if (group) labels.push(getTranslation(group.label, i18n))
		} else if (kind === 'collection') {
			const plural = payload.collections[slug as CollectionSlug]?.config.labels?.plural
			labels.push(plural ? getTranslation(plural, i18n) : slug)
		} else if (kind === 'global') {
			const label = payload.globals.config.find((global) => global.slug === slug)?.label
			labels.push(label ? getTranslation(label, i18n) : slug)
		} else if (kind === 'custom') {
			const target = options.customTargets.find((candidate) => candidate.key === slug)
			labels.push(target ? getTranslation(target.label, i18n) : slug)
		}
	}
	return labels
}

const hasContent = (message: SerializedEditorState | null | undefined): boolean => {
	const root = message?.root
	return Boolean(root && Array.isArray(root.children) && root.children.length > 0)
}

/** A message and the content locale it was actually loaded in. */
type LoadedMessage = { state: SerializedEditorState; locale: string | undefined }

type WindowMessages = {
	announced?: LoadedMessage
	active?: LoadedMessage
}

type MessageDoc = {
	id: number | string
	announcementMessage?: SerializedEditorState | null
	activeMessage?: SerializedEditorState | null
}

const MESSAGE_FIELDS = [
	['announced', 'announcementMessage'],
	['active', 'activeMessage'],
] as const

const readMessages = async ({
	payload,
	slug,
	ids,
	locale,
}: {
	payload: Payload
	slug: string
	ids: string[]
	locale: string | undefined
}): Promise<MessageDoc[]> => {
	const { docs } = await payload.find({
		collection: slug as CollectionSlug,
		depth: 0,
		fallbackLocale: false,
		limit: 0,
		locale: locale as TypedLocale | undefined,
		overrideAccess: true,
		pagination: false,
		select: { announcementMessage: true, activeMessage: true } as SelectType,
		where: { id: { in: ids } },
	})
	return docs as unknown as MessageDoc[]
}

/**
 * The published, non-empty messages of the given windows, by window id, each
 * with the locale it came in: the viewer's content locale, or the default one
 * for a message not translated yet. At most two reads.
 */
const loadMessages = async ({
	payload,
	slug,
	ids,
	locale,
}: {
	payload: Payload
	slug: string
	ids: string[]
	locale: string | undefined
}): Promise<Map<string, WindowMessages>> => {
	const messages = new Map<string, WindowMessages>()
	const collect = (docs: MessageDoc[], docLocale: string | undefined) => {
		for (const doc of docs) {
			const entry = messages.get(String(doc.id)) ?? {}
			for (const [stage, field] of MESSAGE_FIELDS) {
				const state = doc[field]
				if (!entry[stage] && state && hasContent(state)) {
					entry[stage] = { state, locale: docLocale }
				}
			}
			messages.set(String(doc.id), entry)
		}
	}
	collect(await readMessages({ payload, slug, ids, locale }), locale)
	const defaultLocale = payload.config.localization
		? payload.config.localization.defaultLocale
		: undefined
	const untranslated = ids.filter((id) => {
		const entry = messages.get(id)
		return !entry?.announced || !entry.active
	})
	if (locale !== undefined && locale !== defaultLocale && untranslated.length > 0) {
		collect(
			await readMessages({ payload, slug, ids: untranslated, locale: defaultLocale }),
			defaultLocale
		)
	}
	return messages
}

/**
 * Admin header slot: the lock banner, paging through every active and
 * announced window in the order that matters for this page, plus the state
 * sync feeding `useContentLock`. Rendered by the default template on every
 * view, so it follows navigation.
 */
export const ContentLockHeader = async ({
	collectionSlug,
	globalSlug,
	i18n,
	params,
	payload,
}: HeaderProps) => {
	if (!payload || !i18n) {
		return null
	}
	const options = optionsFromConfig(payload.config)
	let state: Awaited<ReturnType<typeof getContentLockState>>
	try {
		state = await getContentLockState(payload)
	} catch (error) {
		payload.logger.error({
			err: error,
			msg: '[content-lock] cannot read lock state for the banner',
		})
		return null
	}
	const route: EntityRef[] = [
		...(collectionSlug ? [{ type: 'collection', slug: collectionSlug } as const] : []),
		...(globalSlug ? [{ type: 'global', slug: globalSlug } as const] : []),
		...customTargetsAt(options.customTargets, adminPath(params)).map(
			(key) => ({ type: 'custom', slug: key }) as const
		),
	]
	const windows = orderBanners(state, options.groups, route.length > 0 ? route : null)
	const sync = <ContentLockStateSync state={state} />
	if (windows.length === 0) {
		return sync
	}
	const localization = payload.config.localization
	const messages = await loadMessages({
		payload,
		slug: options.slug,
		ids: windows.map((window) => window.id),
		locale: resolveMessageLocale({
			contentLocales: localization ? localization.localeCodes : [],
			defaultLocale: localization ? localization.defaultLocale : undefined,
			language: i18n.language,
			localeMap: options.localeMap,
		}),
	}).catch((error: unknown) => {
		payload.logger.error({ err: error, msg: '[content-lock] cannot load banner messages' })
		return new Map<string, WindowMessages>()
	})
	const projectConverters = options.editorConverters
		? (payload.importMap[options.editorConverters] as JSXConvertersFunction | undefined)
		: undefined
	if (options.editorConverters && !projectConverters) {
		payload.logger.warn(
			`[content-lock] converters "${options.editorConverters}" are not in the import map; banners render with the plugin's own converters`
		)
	}
	const items = windows.map((window): BannerItem => {
		const status = state.active.includes(window) ? 'active' : 'announced'
		const labels = scopeLabels({
			scope: scopeOf(window, options.groups),
			window,
			payload,
			i18n,
			options,
		})
		const endsAt = window.endMode === 'at' ? window.endsAt : null
		const message = messages.get(window.id)?.[status]
		// The scope token reads in the message's language, like its dates.
		const messageLabels =
			message?.locale === undefined
				? labels
				: scopeLabels({
						scope: scopeOf(window, options.groups),
						window,
						payload,
						i18n: { ...i18n, language: languageForLocale(message.locale, options.localeMap) },
						options,
					})
		return {
			id: window.id,
			status,
			dismissKey: `${window.id}:${window.announceAt ?? ''}:${window.startsAt}`,
			startsAt: window.startsAt,
			endsAt,
			scopeLabels: labels,
			message: message ? (
				<RichText
					converters={composeConverters(
						buildMessageConverters({
							startsAt: window.startsAt,
							endsAt,
							announceAt: window.announceAt,
							scopeLabels: messageLabels,
							locale: message.locale,
						}),
						projectConverters
					)}
					data={message.state}
					disableContainer
				/>
			) : null,
		}
	})
	return (
		<>
			{sync}
			<ContentLockBanner items={items} />
		</>
	)
}
