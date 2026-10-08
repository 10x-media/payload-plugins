'use client'

import { getTranslation } from '@payloadcms/translations'
import { escapeDiffHTML, getHTMLDiffComponents, unescapeDiffHTML, useConfig } from '@payloadcms/ui'
import { formatDate } from '@payloadcms/ui/shared'
import type { ClientBlock, ClientField } from 'payload'
import { toWords } from 'payload/shared'
import type { ReactNode } from 'react'

import { isEmpty, listOf, relationId } from '../merge/compare'
import type { DecisionView } from '../merge/planResponse'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }

/** The text of the version view's escaped markup, for a label React writes as text. */
const plainText = (html: string): string =>
	unescapeDiffHTML(html).replace(
		/&(amp|lt|gt|quot|#39);/g,
		(_, name: string) => ENTITIES[name] ?? ''
	)

const baseClass = 'dedupe-merge'

/** Types the version view compares letter by letter; anything else is compared whole. */
const BY_CHARACTER = new Set(['text', 'textarea', 'email', 'code', 'number'])

/** When something happened, short enough for a column head: `29.09.26 14:08:15`. */
export const SHORT_DATE = 'dd.MM.yy HH:mm:ss'

/** Decision keys named as the screen labels them, a localized one with its locale. */
export const fieldList = (decisions: DecisionView[], keyList: string[]): string =>
	keyList
		.map((key) => {
			const decision = decisions.find((entry) => entry.key === key)
			if (!decision) return toWords(key)
			return decision.locale ? `${decision.label} (${decision.locale})` : decision.label
		})
		.join(', ')

/** A value as HTML for the version view's diff, and whether it compares letter by letter. */
type Markup = { html: string; byCharacter: boolean }

/** How the version view marks a value: added, or removed. */
export type Mark = 'create' | undefined

/** A value, or one item of a list, marked as a whole in the version view's colours. */
const marked = (mark: Mark, inner: string, block = false): string => {
	if (!mark) return inner
	const tag = block ? 'div' : 'span'
	return `<${tag} data-match-type="${mark}">${inner}</${tag}>`
}

type Described = Pick<DecisionView, 'html' | 'list' | 'path' | 'relationLabels' | 'type'>

const scalar = (value: unknown): string =>
	value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)

/** The text of a Lexical document, one paragraph per top-level node. */
const richTextParagraphs = (value: unknown): string[] | null => {
	const root = (value as { root?: { children?: unknown[] } } | null)?.root
	if (!root || !Array.isArray(root.children)) return null
	const text = (node: unknown): string => {
		const record = node as { text?: unknown; children?: unknown[] } | null
		if (typeof record?.text === 'string') return record.text
		return Array.isArray(record?.children) ? record.children.map(text).join('') : ''
	}
	return root.children.map(text).filter((line) => line !== '')
}

/** One entry of a list as the merge screen labels it: a row's label, or a value. */
export type Entry = {
	title: string
	/** A block row's number and type, drawn apart as the blocks field draws them. */
	block: { number: string; label: string } | null
}

type Fielded = ClientField & { name: string; fields?: ClientField[] }

/** The field at `path` in the collection's client config, through groups, named tabs and layout. */
export const fieldAt = (fields: ClientField[], path: string[]): ClientField | undefined => {
	const [name, ...rest] = path
	for (const field of fields) {
		if (field.type === 'tabs') {
			for (const tab of field.tabs) {
				const named = 'name' in tab && typeof tab.name === 'string' ? tab.name : null
				const found = named
					? named === name
						? fieldAt(tab.fields, rest)
						: undefined
					: fieldAt(tab.fields, path)
				if (found) return found
			}
			continue
		}
		const { fields: inner, name: own } = field as Partial<Fielded>
		if (!own) {
			const found = inner ? fieldAt(inner, path) : undefined
			if (found) return found
			continue
		}
		if (own !== name) continue
		if (rest.length === 0) return field
		return inner ? fieldAt(inner, rest) : undefined
	}
	return undefined
}

const rowsOf = (value: unknown): Record<string, unknown>[] =>
	listOf(value).filter(
		(row): row is Record<string, unknown> => row !== null && typeof row === 'object'
	)

/** Builds the HTML a value is diffed as and a list is shown as, from the collection's own fields. */
export const useFormat = (collection: string) => {
	const { i18n } = useTranslation()
	const { config, getEntityConfig } = useConfig()
	const fields = getEntityConfig({ collectionSlug: collection })?.fields ?? []

	const label = (field: ClientField): string => {
		const { label: own, name } = field as Partial<Fielded> & { label?: unknown }
		return own ? getTranslation(own as string, i18n) : toWords(name ?? '')
	}
	const blockOf = (field: ClientField, slug: unknown): ClientBlock | undefined => {
		const { blockReferences = [], blocks = [] } = field as {
			blockReferences?: (ClientBlock | string)[]
			blocks?: ClientBlock[]
		}
		return [...blocks, ...blockReferences]
			.map((block) => (typeof block === 'string' ? config.blocksMap?.[block] : block))
			.find((block) => block?.slug === slug)
	}
	const rowFields = (field: ClientField, row: Record<string, unknown>): ClientField[] =>
		field.type === 'blocks'
			? (blockOf(field, row.blockType)?.fields ?? [])
			: ((field as Fielded).fields ?? [])

	/** A related document's title from the plan, keyed by `collection:id`, or by id at the top level. */
	const related = (
		labels: Record<string, string> | undefined,
		slug: string | null,
		item: unknown
	) => {
		const pointer = item as { relationTo?: unknown; value?: unknown } | null
		const [collectionOf, id] =
			typeof pointer?.relationTo === 'string'
				? [pointer.relationTo, relationId(pointer.value)]
				: [slug, relationId(item)]
		return labels?.[`${collectionOf}:${id}`] ?? labels?.[id] ?? id
	}

	const leaf = (field: ClientField, value: unknown, labels?: Record<string, string>): string => {
		const values = listOf(value)
		switch (field.type) {
			case 'relationship':
			case 'upload': {
				const slug = typeof field.relationTo === 'string' ? field.relationTo : null
				return values.map((item) => related(labels, slug, item)).join(', ')
			}
			case 'select':
			case 'radio':
				return values
					.map((item) => {
						const option = field.options.find(
							(entry) => (typeof entry === 'string' ? entry : entry.value) === item
						)
						return option && typeof option !== 'string'
							? getTranslation(option.label as string, i18n)
							: String(item)
					})
					.join(', ')
			case 'date':
				return values
					.map((item) => formatDate({ date: String(item), i18n, pattern: config.admin.dateFormat }))
					.join(', ')
			case 'richText':
				return (richTextParagraphs(value) ?? [scalar(value)]).join(' ')
			default:
				return values.map(scalar).join(', ')
		}
	}

	// Lines of a row are `div`s: the version view pads a changed `p` 10px beyond itself, which
	// on lines set close together covers the line above. A marked row marks each line's text,
	// as the version view marks text, rather than filling the row as one block.
	const body = (
		inner: ClientField[],
		row: Record<string, unknown>,
		{ labels, mark }: { labels?: Record<string, string>; mark?: Mark } = {}
	): string =>
		inner
			.flatMap((field): string[] => {
				const { name } = field as Partial<Fielded>
				if (!name) {
					const nested = (field as Partial<Fielded>).fields
					return nested ? [body(nested, row, { labels, mark })] : []
				}
				const value = row[name]
				// The row's own id and whatever the admin hides are not part of what it says.
				const hidden = (field as { admin?: { hidden?: boolean } }).admin?.hidden === true
				if (isEmpty(value) || name === 'id' || hidden) return []
				if (field.type === 'group') {
					return [
						`<div><strong>${marked(mark, escapeDiffHTML(label(field)))}</strong></div>${body((field as Fielded).fields ?? [], value as Record<string, unknown>, { labels, mark })}`,
					]
				}
				if (field.type === 'array' || field.type === 'blocks') {
					const items = rowsOf(value).map((entry, index) => {
						const nested = entryOf({ field, row: entry, index })
						return `<li><strong>${marked(mark, escapeDiffHTML(nested.title))}</strong>${body(rowFields(field, entry), entry, { labels, mark })}</li>`
					})
					return [
						`<div><strong>${marked(mark, escapeDiffHTML(label(field)))}</strong></div><ul>${items.join('')}</ul>`,
					]
				}
				if (field.type === 'ui' || field.type === 'join') return []
				return [
					`<div>${marked(mark, `${escapeDiffHTML(label(field))}: ${escapeDiffHTML(leaf(field, value, labels))}`)}</div>`,
				]
			})
			.join('')

	/** A row labelled as the admin labels it: `Publication 01`, or `01 · Section` for a block. */
	const entryOf = (args: {
		field: ClientField
		row: Record<string, unknown>
		index: number
	}): Entry => {
		const { field, row, index } = args
		const number = String(index + 1).padStart(2, '0')
		const block = field.type === 'blocks' ? blockOf(field, row.blockType) : undefined
		const blockLabel = block?.labels?.singular
			? getTranslation(block.labels.singular as string, i18n)
			: toWords(String(row.blockType))
		const singular = (field as { labels?: { singular?: unknown } }).labels?.singular
		const title =
			field.type === 'blocks'
				? `${number} · ${blockLabel}`
				: `${singular ? getTranslation(singular as string, i18n) : label(field)} ${number}`
		return { title, block: field.type === 'blocks' ? { number, label: blockLabel } : null }
	}

	const item = (
		decision: Described,
		value: unknown,
		{ index, mark }: { index: number; mark?: Mark } = { index: 0 }
	): string => {
		switch (decision.type) {
			case 'relationship':
			case 'upload': {
				const id = relationId(value)
				return escapeDiffHTML(decision.relationLabels?.[id] ?? id)
			}
			case 'date':
				return typeof value === 'string'
					? escapeDiffHTML(formatDate({ date: value, i18n, pattern: config.admin.dateFormat }))
					: escapeDiffHTML(scalar(value))
			case 'select':
			case 'radio': {
				const field = fieldAt(fields, decision.path.split('.'))
				return escapeDiffHTML(field ? leaf(field, value) : scalar(value))
			}
			case 'array':
			case 'blocks': {
				const field = fieldAt(fields, decision.path.split('.'))
				if (!field || value === null || typeof value !== 'object')
					return escapeDiffHTML(scalar(value))
				const row = value as Record<string, unknown>
				const entry = entryOf({ field, row, index })
				return `<strong>${marked(mark, escapeDiffHTML(entry.title))}</strong>${body(rowFields(field, row), row, { labels: decision.relationLabels, mark })}`
			}
			default:
				return escapeDiffHTML(scalar(value))
		}
	}

	/** One entry of a list: a row with its label, or a single value of a `hasMany` field. */
	const entry = (decision: Described, value: unknown, index: number): Entry => {
		const field =
			decision.type === 'array' || decision.type === 'blocks'
				? fieldAt(fields, decision.path.split('.'))
				: undefined
		if (field && value !== null && typeof value === 'object') {
			return entryOf({ field, row: value as Record<string, unknown>, index })
		}
		return { title: plainText(item(decision, value, { index })), block: null }
	}

	/**
	 * `doc` names whose value it is, for rich text the server has drawn already. `mark` marks
	 * the value as a whole, or a list item by item.
	 */
	const markup = (
		decision: Described,
		value: unknown,
		{ doc, mark }: { doc?: string; mark?: Mark | ((index: number) => Mark) } = {}
	): Markup => {
		if (isEmpty(value)) return { html: '', byCharacter: true }
		const whole = typeof mark === 'function' ? undefined : mark
		const drawn = doc === undefined ? undefined : decision.html?.[doc]
		// Compared word by word, as the version view compares rich text.
		if (drawn !== undefined) return { html: marked(whole, drawn, true), byCharacter: false }
		if (decision.type === 'richText') {
			const paragraphs = richTextParagraphs(value) ?? [scalar(value)]
			return {
				html: paragraphs.map((line) => `<p>${marked(whole, escapeDiffHTML(line))}</p>`).join(''),
				byCharacter: true,
			}
		}
		if (decision.type === 'point' && Array.isArray(value)) {
			return {
				html: `<p>${marked(whole, escapeDiffHTML(value.join(', ')))}</p>`,
				byCharacter: false,
			}
		}
		if (decision.type === 'json') {
			return {
				html: `<pre>${marked(whole, escapeDiffHTML(JSON.stringify(value, null, 2)))}</pre>`,
				byCharacter: false,
			}
		}
		const rows = decision.type === 'array' || decision.type === 'blocks'
		if (decision.list || rows || Array.isArray(value)) {
			const markOf = typeof mark === 'function' ? mark : () => mark
			const items = listOf(value).map(
				(entry, index) =>
					`<li>${
						rows
							? item(decision, entry, { index, mark: markOf(index) })
							: marked(markOf(index), item(decision, entry, { index }))
					}</li>`
			)
			return { html: `<ul>${items.join('')}</ul>`, byCharacter: false }
		}
		if (
			typeof value === 'object' &&
			decision.type !== 'relationship' &&
			decision.type !== 'upload'
		) {
			return {
				html: `<pre>${marked(whole, escapeDiffHTML(JSON.stringify(value, null, 2)))}</pre>`,
				byCharacter: false,
			}
		}
		return {
			html: `<p>${marked(whole, item(decision, value))}</p>`,
			byCharacter: BY_CHARACTER.has(decision.type),
		}
	}

	return { entry, markup }
}

/** A value with nothing marked, for a field no side is chosen for yet. */
export const Plain = ({ markup }: { markup: Markup }) => {
	const { t } = useTranslation()
	if (!markup.html) return <span className={`${baseClass}__value--empty`}>{t(keys.empty)}</span>
	return (
		<div
			className="html-diff"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: built from escaped values, as the version view does
			dangerouslySetInnerHTML={{ __html: unescapeDiffHTML(markup.html) }}
		/>
	)
}

/** `to` as the version view shows a change: what it adds over `from` in the admin's colour. */
export const diffOf = (from: Markup, to: Markup): ReactNode => {
	if (!to.html) return <Plain markup={to} />
	const { To } = getHTMLDiffComponents({
		fromHTML: from.html,
		toHTML: to.html,
		postProcess: unescapeDiffHTML,
		tokenizeByCharacter: from.byCharacter && to.byCharacter,
	})
	return To
}
