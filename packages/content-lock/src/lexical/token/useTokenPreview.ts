'use client'

import { useEditorConfigContext } from '@payloadcms/richtext-lexical/client'
import { getTranslation } from '@payloadcms/translations'
import { useConfig, useFormFields, useLocale } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import { formatInstant } from '../../banner/formatDate'
import { intlLanguage } from '../../banner/locale'
import { namedTargets } from '../../state/resolve'
import { keys, type TranslationKey } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { ContentLockTokenClientProps } from './server'
import {
	TOKEN_FEATURE_KEY,
	type TokenData,
	type TokenWindowValues,
	tokenKindLabel,
	tokenProblem,
} from './types'

const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

const asIso = (value: unknown): string | null => {
	if (value instanceof Date) {
		return value.toISOString()
	}
	return typeof value === 'string' && value.length > 0 ? value : null
}

/** The window fields tokens read from the document form. */
export const useWindowForm = () => {
	const startsAt = useFormFields(([fields]) => fields.startsAt?.value)
	const endsAt = useFormFields(([fields]) => fields.endsAt?.value)
	const announce = useFormFields(([fields]) => fields.announce?.value)
	const announceAt = useFormFields(([fields]) => fields.announceAt?.value)
	const endAtTime = useFormFields(([fields]) => fields.endAtTime?.value)
	const lockEverything = useFormFields(([fields]) => fields.lockEverything?.value)
	const groups = useFormFields(([fields]) => fields.groups?.value)
	const collections = useFormFields(([fields]) => fields.collections?.value)
	const globals = useFormFields(([fields]) => fields.globals?.value)
	const customTargets = useFormFields(([fields]) => fields.customTargets?.value)
	return {
		startsAt: asIso(startsAt),
		endsAt: asIso(endsAt),
		announceAt: asIso(announceAt),
		values: { announce, announceAt, endAtTime, lockEverything } satisfies TokenWindowValues,
		groups: asStrings(groups),
		collections: asStrings(collections),
		globals: asStrings(globals),
		customTargets: asStrings(customTargets),
	}
}

/**
 * What a token will read as in the banner, from the live form and in the
 * document's content locale, plus the problem that keeps it from rendering, if
 * any. Relative dates tick once a minute.
 */
export const useTokenPreview = (
	data: TokenData
): { text: string; problem: TranslationKey | null; values: TokenWindowValues } => {
	const { editorConfig } = useEditorConfigContext()
	const { config } = useConfig()
	const { t, i18n } = useTranslation()
	const locale = useLocale()
	const form = useWindowForm()
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		if (data.format !== 'relative') {
			return
		}
		const timer = setInterval(() => setNow(Date.now()), 60_000)
		return () => clearInterval(timer)
	}, [data.format])

	const problem = tokenProblem(data, form.values)
	const featureProps = editorConfig.resolvedFeatureMap.get(TOKEN_FEATURE_KEY)
		?.sanitizedClientFeatureProps as ContentLockTokenClientProps | undefined
	const groups = featureProps?.groups
	const customLabels = featureProps?.customTargets ?? []

	// Labels in the document's content locale where they have one, like the dates.
	const labelI18n = locale?.code ? { ...i18n, language: locale.code } : i18n
	const scopeText = () => {
		const targets = namedTargets(
			[
				...form.groups.map((key) => `group:${key}`),
				...form.collections.map((slug) => `collection:${slug}`),
				...form.globals.map((slug) => `global:${slug}`),
				...form.customTargets.map((key) => `custom:${key}`),
			],
			groups ?? []
		)
		return targets
			.map((target) => {
				const separator = target.indexOf(':')
				const kind = target.slice(0, separator)
				const slug = target.slice(separator + 1)
				if (kind === 'group') {
					const group = groups?.find((candidate) => candidate.key === slug)
					return group ? getTranslation(group.label, labelI18n) : slug
				}
				if (kind === 'custom') {
					const target = customLabels.find((candidate) => candidate.key === slug)
					return target ? getTranslation(target.label, labelI18n) : slug
				}
				if (kind === 'collection') {
					const plural = config.collections.find((entry) => entry.slug === slug)?.labels?.plural
					return plural ? getTranslation(plural, labelI18n) : slug
				}
				const label = config.globals.find((entry) => entry.slug === slug)?.label
				return label ? getTranslation(label, labelI18n) : slug
			})
			.join(', ')
	}

	const text = (): string => {
		if (problem) {
			return t(tokenKindLabel[data.token])
		}
		if (data.token === 'scope') {
			return scopeText() || t(tokenKindLabel.scope)
		}
		const iso = data.token === 'date' ? (data.date ?? null) : form[data.token]
		if (iso === null) {
			return data.token === 'startsAt'
				? t(keys.tokenStartsOnPublish)
				: t(tokenKindLabel[data.token])
		}
		// The document's content locale, the language this message is written in.
		const language = intlLanguage(locale?.code, i18n.language)
		return formatInstant({ iso, format: data.format, language, now })
	}

	return { text: text(), problem, values: form.values }
}
