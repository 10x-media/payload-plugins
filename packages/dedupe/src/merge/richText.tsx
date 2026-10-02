import { createHash } from 'node:crypto'
import type {
	SerializedAutoLinkNode,
	SerializedBlockNode,
	SerializedLinkNode,
	SerializedListItemNode,
	SerializedRelationshipNode,
	SerializedUploadNode,
} from '@payloadcms/richtext-lexical'
import type {
	HTMLConvertersAsync,
	HTMLConvertersFunctionAsync,
} from '@payloadcms/richtext-lexical/html-async'
import { getTranslation } from '@payloadcms/translations'
import type { FileData, PayloadRequest, TypeWithID } from 'payload'
import { formatAdminURL, formatFilesize, sanitizeUrl } from 'payload/shared'
import type { ReactElement } from 'react'

import type { DocValue } from '../schema/types'

type Lexical = {
	convert: typeof import('@payloadcms/richtext-lexical/html-async')['convertLexicalToHTMLAsync']
	populateFn: typeof import('@payloadcms/richtext-lexical')['getPayloadPopulateFn']
}

/**
 * Lexical's converters, loaded when a value needs them. The package is an optional peer, so a
 * host without it gets `null`.
 */
const loadLexical = async (): Promise<Lexical | null> => {
	try {
		const [html, lexical] = await Promise.all([
			import('@payloadcms/richtext-lexical/html-async'),
			import('@payloadcms/richtext-lexical'),
		])
		return { convert: html.convertLexicalToHTMLAsync, populateFn: lexical.getPayloadPopulateFn }
	} catch {
		return null
	}
}

const isLexical = (value: unknown): boolean =>
	Array.isArray((value as { root?: { children?: unknown } } | null)?.root?.children)

const escapeHTML = (value: string): string =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')

/** A node's settings as an attribute, so a change to them counts as a change in the diff. */
const hashOf = (value: unknown): string =>
	createHash('sha256')
		.update(JSON.stringify(value ?? {}))
		.digest('hex')

type Doc = FileData & TypeWithID & Record<string, unknown>

/** Payload's `CheckIcon` and `File` drawings; its `ui/rsc` export loads stylesheets Node cannot. */
const checkIcon = (
	<svg
		aria-hidden="true"
		className="icon icon--check"
		viewBox="0 0 20 20"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path
			className="stroke"
			d="M15.3333 6.00001L8.00001 13.3333L4.66667 10"
			strokeLinecap="square"
		/>
	</svg>
)

const fileIcon = (
	<svg
		aria-hidden="true"
		height="150"
		style={{ backgroundColor: '#333333' }}
		viewBox="0 0 150 150"
		width="150"
		xmlns="http://www.w3.org/2000/svg"
	>
		<path d="M82.8876 50.5H55.5555V100.5H94.4444V61.9818H82.8876V50.5Z" fill="white" />
		<path d="M82.8876 61.9818H94.4444L82.8876 50.5V61.9818Z" fill="#9A9A9A" />
	</svg>
)

/**
 * The version view's converters for what plain HTML leaves out: an internal link's target,
 * a checklist item, an upload's card, a related document's card and a block by its type.
 */
const diffConverters = (
	req: PayloadRequest,
	render: (element: ReactElement) => string
): HTMLConvertersAsync<
	| SerializedAutoLinkNode
	| SerializedLinkNode
	| SerializedListItemNode
	| SerializedRelationshipNode
	| SerializedUploadNode
> => {
	const { config } = req.payload
	const adminURL = (slug: string, id: number | string) =>
		formatAdminURL({
			adminRoute: config.routes.admin,
			path: `/collections/${slug}/${id}`,
			serverURL: config.serverURL,
		})
	const anchor =
		(node: SerializedLinkNode | SerializedAutoLinkNode, href: string, style: string) =>
		(children: string) =>
			`<a${style} data-fields-hash="${hashOf(node.fields)}" data-enable-match="true" href="${escapeHTML(sanitizeUrl(href))}"${node.fields.newTab ? ' rel="noopener noreferrer" target="_blank"' : ''}>${children}</a>`
	return {
		autolink: async ({ node, nodesToHTML, providedStyleTag }) =>
			anchor(
				node,
				node.fields.url ?? '',
				providedStyleTag
			)((await nodesToHTML({ nodes: node.children })).join('')),
		link: async ({ node, nodesToHTML, populate, providedStyleTag }) => {
			let href = node.fields.url ?? ''
			if (node.fields.linkType === 'internal') {
				const target = node.fields.doc
				if (!target) href = '#'
				else {
					const { relationTo, value } = target
					const id =
						typeof value === 'object' && value !== null
							? value.id
							: ((await populate?.({ id: value, collectionSlug: relationTo }))?.id ?? value)
					href = adminURL(relationTo, id)
				}
			}
			return anchor(
				node,
				href,
				providedStyleTag
			)((await nodesToHTML({ nodes: node.children })).join(''))
		},
		listitem: async ({ node, nodesToHTML, parent, providedCSSString }) => {
			const nested = node.children.some((child) => child.type === 'list')
			const children = (await nodesToHTML({ nodes: node.children })).join('')
			if (!('listType' in parent) || parent.listType !== 'check') {
				return `<li class="${nested ? 'nestedListItem' : ''}" style="${nested ? `list-style-type: none;${providedCSSString}` : providedCSSString}" value="${node.value}" data-enable-match="true">${children}</li>`
			}
			const state = node.checked ? 'checkboxItem--checked' : 'checkboxItem--unchecked'
			const body = nested
				? `<div>${children}</div>`
				: `<div class="checkboxItem__wrapper"><div class="checkboxItem__icon" data-checked="${Boolean(node.checked)}" data-enable-match="true">${node.checked ? render(checkIcon) : ''}</div><span class="checkboxItem__label">${children}</span></div>`
			return `<li aria-checked="${Boolean(node.checked)}" class="checkboxItem ${state}${nested ? ' checkboxItem--nested' : ''}" role="checkbox" style="list-style-type: none;${providedCSSString}" value="${node.value}">${body}</li>`
		},
		relationship: async ({ node, populate, providedCSSString }) => {
			if (typeof node.value !== 'object' && !populate) return ''
			const id = typeof node.value === 'object' ? node.value.id : node.value
			const data =
				typeof node.value === 'object'
					? (node.value as unknown as Doc)
					: await populate?.<Doc>({ id, collectionSlug: node.relationTo })
			const related = config.collections.find(({ slug }) => slug === node.relationTo)
			const titleField = related?.admin?.useAsTitle
			const title = data && titleField ? data[titleField] : undefined
			return render(
				<div
					className={`lexical-relationship-diff${providedCSSString}`}
					data-enable-match="true"
					data-id={id}
					data-slug={node.relationTo}
				>
					<div className="lexical-relationship-diff__card">
						<div className="lexical-relationship-diff__collectionLabel">
							{req.i18n.t('fields:labelRelationship', {
								label: related?.labels?.singular
									? getTranslation(related.labels.singular, req.i18n)
									: related?.slug,
							})}
						</div>
						{title && data ? (
							<strong className="lexical-relationship-diff__title" data-enable-match="false">
								<a
									className="lexical-relationship-diff__link"
									data-enable-match="false"
									href={adminURL(node.relationTo, data.id)}
									rel="noopener noreferrer"
									target="_blank"
								>
									{String(title)}
								</a>
							</strong>
						) : (
							<strong>{String(id)}</strong>
						)}
					</div>
				</div>
			)
		},
		upload: async ({ node, populate, providedCSSString }) => {
			const file =
				typeof node.value === 'object'
					? (node.value as unknown as Doc)
					: await populate?.<Doc>({ id: node.value, collectionSlug: node.relationTo })
			if (!file) return ''
			const alt = String((node.fields?.alt as string | undefined) || file.alt || '')
			const thumbnail = String(file.thumbnailURL || file.url || '')
			return render(
				<div
					className={`lexical-upload-diff${providedCSSString}`}
					data-enable-match="true"
					data-fields-hash={hashOf(node.fields)}
					data-filename={file.filename}
					data-lexical-upload-id={typeof node.value === 'object' ? file.id : node.value}
					data-lexical-upload-relation-to={node.relationTo}
					data-src={thumbnail}
				>
					<div className="lexical-upload-diff__card">
						<div className="lexical-upload-diff__thumbnail">
							{thumbnail ? (
								// biome-ignore lint/performance/noImgElement: markup for a diff, drawn once on the server, as Payload's own is
								<img alt={alt} src={thumbnail} />
							) : (
								fileIcon
							)}
						</div>
						<div className="lexical-upload-diff__info" data-enable-match="false">
							<strong>{file.filename}</strong>
							<div className="lexical-upload-diff__meta">
								{[
									formatFilesize(file.filesize),
									typeof file.width === 'number' && typeof file.height === 'number'
										? `${file.width}x${file.height}`
										: null,
									file.mimeType,
								]
									.filter(Boolean)
									.join(' - ')}
							</div>
						</div>
					</div>
				</div>
			)
		},
		unknown: async ({ node, providedCSSString }) => {
			const block = node.type === 'block' || node.type === 'inlineBlock'
			return render(
				<div
					className={`lexical-unknown-diff${providedCSSString}`}
					data-enable-match="true"
					data-fields-hash={hashOf(node)}
				>
					{block ? (
						<span className="lexical-unknown-diff__specifier">
							{(node as SerializedBlockNode).fields.blockType}&nbsp;
						</span>
					) : null}
					<span>
						{node.type === 'block'
							? 'Block'
							: node.type === 'inlineBlock'
								? 'InlineBlock'
								: node.type}
					</span>
					<div className="lexical-unknown-diff__meta">
						<br />
					</div>
				</div>
			)
		},
	}
}

/**
 * Each document's rich text as the version view draws it: Lexical turned into HTML on the
 * server, related documents and uploads read with the reviewer's access. `undefined` where no
 * value is Lexical or the host does not have Lexical installed.
 */
export const richTextHTML = async (
	req: PayloadRequest,
	values: DocValue[]
): Promise<Record<string, string> | undefined> => {
	const lexical = values.some(({ value }) => isLexical(value)) ? await loadLexical() : null
	if (!lexical) return undefined
	const { renderToStaticMarkup } = await import('react-dom/server')
	const populate = await lexical.populateFn({
		currentDepth: 0,
		depth: 1,
		overrideAccess: false,
		req,
	})
	const converters: HTMLConvertersFunctionAsync = ({ defaultConverters }) => ({
		...defaultConverters,
		...diffConverters(req, renderToStaticMarkup),
	})
	const out: Record<string, string> = {}
	for (const { doc, value } of values) {
		if (!isLexical(value)) continue
		out[doc] = await lexical.convert({
			converters,
			data: value as Parameters<Lexical['convert']>[0]['data'],
			disableContainer: true,
			populate,
		})
	}
	return out
}
