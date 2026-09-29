import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { getTranslation, type I18nClient } from '@payloadcms/translations'
import type { CollectionSlug, Payload, SelectType, ServerProps, TypedLocale } from 'payload'

import { optionsFromConfig, type ResolvedOptions } from '../options'
import { orderBanners, scopeOf } from '../state/resolve'
import { getContentLockState } from '../state/store'
import type { LockWindow, ResolvedScope } from '../state/types'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { type BannerItem, ContentLockBanner } from './ContentLockBanner'
import { ContentLockStateSync } from './ContentLockProvider'
import { buildMessageConverters } from './messageConverters'

type HeaderProps = ServerProps & { collectionSlug?: string; globalSlug?: string }

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
	for (const target of window.targets) {
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
		}
	}
	return labels
}

/** The content locale for a message: the admin language when it is one, else the default. */
const messageLocale = (payload: Payload, language: string): TypedLocale | undefined => {
	const localization = payload.config.localization
	if (!localization) {
		return undefined
	}
	const codes = localization.localeCodes
	return (codes.includes(language) ? language : localization.defaultLocale) as TypedLocale
}

const hasContent = (message: SerializedEditorState | null | undefined): boolean => {
	const root = message?.root
	return Boolean(root && Array.isArray(root.children) && root.children.length > 0)
}

type WindowMessages = {
	announced?: SerializedEditorState
	active?: SerializedEditorState
}

type MessageDoc = {
	id: number | string
	announcementMessage?: SerializedEditorState | null
	activeMessage?: SerializedEditorState | null
}

/**
 * The published, non-empty messages of the given windows, in one read, by
 * window id. The content locale's own fallback applies, so an untranslated
 * message shows in the default locale.
 */
const loadMessages = async ({
	payload,
	slug,
	ids,
	language,
}: {
	payload: Payload
	slug: string
	ids: string[]
	language: string
}): Promise<Map<string, WindowMessages>> => {
	const { docs } = await payload.find({
		collection: slug as CollectionSlug,
		depth: 0,
		limit: 0,
		locale: messageLocale(payload, language),
		overrideAccess: true,
		pagination: false,
		select: { announcementMessage: true, activeMessage: true } as SelectType,
		where: { id: { in: ids } },
	})
	const messages = new Map<string, WindowMessages>()
	for (const doc of docs as unknown as MessageDoc[]) {
		messages.set(String(doc.id), {
			announced: hasContent(doc.announcementMessage)
				? (doc.announcementMessage ?? undefined)
				: undefined,
			active: hasContent(doc.activeMessage) ? (doc.activeMessage ?? undefined) : undefined,
		})
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
	const route = collectionSlug
		? ({ type: 'collection', slug: collectionSlug } as const)
		: globalSlug
			? ({ type: 'global', slug: globalSlug } as const)
			: null
	const windows = orderBanners(state, options.groups, route)
	const sync = <ContentLockStateSync state={state} />
	if (windows.length === 0) {
		return sync
	}
	const messages = await loadMessages({
		payload,
		slug: options.slug,
		ids: windows.map((window) => window.id),
		language: i18n.language,
	}).catch((error: unknown) => {
		payload.logger.error({ err: error, msg: '[content-lock] cannot load banner messages' })
		return new Map<string, WindowMessages>()
	})
	const t = asTranslate(i18n.t)
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
		return {
			id: window.id,
			status,
			dismissKey: `${window.id}:${window.announceAt ?? ''}:${window.startsAt}`,
			startsAt: window.startsAt,
			endsAt,
			scopeLabels: labels,
			message: message ? (
				<RichText
					converters={buildMessageConverters({
						startsAt: window.startsAt,
						endsAt,
						announceAt: window.announceAt,
						scopeLabels: labels,
						everythingLabel: t(keys.scopeEverything),
						openEndLabel: t(keys.dateOpenEnd),
					})}
					data={message}
					disableContainer
				/>
			) : null,
		}
	})
	return (
		<>
			{sync}
			<ContentLockBanner countdownThresholdMs={options.countdownThresholdMs} items={items} />
		</>
	)
}
