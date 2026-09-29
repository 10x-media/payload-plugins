import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { getTranslation, type I18nClient } from '@payloadcms/translations'
import type { CollectionSlug, Payload, ServerProps, TypedLocale } from 'payload'

import { optionsFromConfig, type ResolvedOptions } from '../options'
import { pickBanner, scopeOf } from '../state/resolve'
import { getContentLockState } from '../state/store'
import type { LockWindow, ResolvedScope } from '../state/types'
import { ContentLockBanner } from './ContentLockBanner'
import { ContentLockStateSync } from './ContentLockProvider'
import { messageConverters } from './messageConverters'

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

const loadMessage = async ({
	payload,
	slug,
	id,
	language,
}: {
	payload: Payload
	slug: string
	id: string
	language: string
}): Promise<SerializedEditorState | null> => {
	const doc = await payload.findByID({
		collection: slug as CollectionSlug,
		id,
		depth: 0,
		locale: messageLocale(payload, language),
		overrideAccess: true,
		select: { message: true },
	})
	const message = (doc as { message?: SerializedEditorState | null }).message
	const root = message?.root
	return root && Array.isArray(root.children) && root.children.length > 0 ? message : null
}

/**
 * Admin header slot: the one lock banner that matters for this page, plus the
 * state sync feeding `useContentLock`. Rendered by the default template on
 * every view, so it follows navigation.
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
	const window = pickBanner(state, options.groups, route)
	const sync = <ContentLockStateSync state={state} />
	if (!window) {
		return sync
	}
	const status = state.active.includes(window) ? 'active' : 'announced'
	const message = await loadMessage({
		payload,
		slug: options.slug,
		id: window.id,
		language: i18n.language,
	}).catch(() => null)
	return (
		<>
			{sync}
			<ContentLockBanner
				countdownThresholdMs={options.countdownThresholdMs}
				dismissKey={`${window.id}:${window.announceAt ?? ''}:${window.startsAt}`}
				endsAt={window.endMode === 'at' ? window.endsAt : null}
				scopeLabels={scopeLabels({
					scope: scopeOf(window, options.groups),
					window,
					payload,
					i18n,
					options,
				})}
				startsAt={window.startsAt}
				status={status}
			>
				{message ? (
					<RichText converters={messageConverters} data={message} disableContainer />
				) : null}
			</ContentLockBanner>
		</>
	)
}
