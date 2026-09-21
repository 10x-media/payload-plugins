import type { PayloadRequest, RichTextField } from 'payload'
import { interpolate } from '../../recall/interpolate'
import type { SubmissionDescriptor, SubmissionValue } from '../../submissions/types'
import type { SubmissionForm } from '../submissionContext'
import type { BodyConverter, BodyRender } from './converters'
import { defaultBodyConverters } from './converters'
import { escapeHtml } from './escapeHtml'
import { serializeSlate } from './serializeSlate'
import { renderAllValues, renderAllValuesTable } from './wildcards'

/** Submission data plus optional converter overrides available while serializing a body. */
export type BodyContext = {
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
	converters?: Record<string, BodyConverter>
}

/**
 * Args a custom `richText.serialize` replacement receives per rendered body. Always populated by
 * `makeRenderBody` (the action-body pipeline): `form` (the whole document) and `req` enable
 * per-tenant template lookups or handing the body off to a renderer like react-email.
 */
export type SerializeBodyArgs = {
	body: unknown
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
	/** The whole form document at depth 0, in the submission's locale; see `SubmissionForm`. */
	form: SubmissionForm
	req?: PayloadRequest
	/**
	 * The submission's own stored locale, the one the form (and so `body`) was loaded at. Use it for
	 * a wrapper's own strings rather than `req.locale`, which on the queued path is the job runner's.
	 */
	locale: string
	/** The `blockType` of the action rendering this body (e.g. `emailTeam`, `confirmation`). */
	actionType: string
}

/**
 * Customizes how the plugin's rich text is authored and rendered. `converters` spread over the
 * default Lexical node converters; `serialize` replaces the whole action-body pipeline (for
 * non-HTML channels like chat or plain text, or to hand the body plus the submitted `form`/`req`
 * off to a renderer like react-email). Wrapping emails in a layout is `email.render`'s job.
 * `editor` is the default Lexical/richText editor for every plugin-authored richText field: message
 * content, consent statement, the response message, and the action body fields. `bodyEditor` overrides the action body fields specifically (emailTeam
 * and confirmation), and `responseEditor` overrides the success `response` message field; both fall
 * back to `editor` when absent.
 */
export type RichTextBodyOption = {
	converters?: Record<string, BodyConverter>
	serialize?: (args: SerializeBodyArgs) => Promise<string> | string
	editor?: RichTextField['editor']
	bodyEditor?: RichTextField['editor']
	responseEditor?: RichTextField['editor']
}

/** Recall resolver over submission values: field name to stringified value, `''` when absent. */
export const resolverFor =
	(values: SubmissionValue[]) =>
	(name: string): string => {
		const entry = values.find((value) => value.field === name)
		return entry == null ? '' : String(entry.value ?? '')
	}

const renderFor = (ctx: BodyContext): BodyRender => {
	const resolve = resolverFor(ctx.values)
	const htmlResolve = (name: string): string => {
		if (name === '*') {
			return renderAllValues(ctx.values, ctx.descriptors)
		}
		if (name === '*:table') {
			return renderAllValuesTable(ctx.values, ctx.descriptors)
		}
		return escapeHtml(resolve(name))
	}
	return {
		text: (raw) => interpolate(escapeHtml(raw), htmlResolve),
		interpolate: (raw) => interpolate(raw, resolve),
	}
}

const serializeNodes = (
	nodes: unknown[],
	converters: Record<string, BodyConverter>,
	render: BodyRender
): string =>
	nodes
		.map((node) => {
			if (node == null || typeof node !== 'object') {
				return ''
			}
			const lexicalNode = node as Record<string, unknown>
			const children = Array.isArray(lexicalNode.children)
				? serializeNodes(lexicalNode.children, converters, render)
				: ''
			const converter =
				typeof lexicalNode.type === 'string' ? converters[lexicalNode.type] : undefined
			return converter ? converter({ node: lexicalNode, children, render }) : children
		})
		.join('')

const lexicalRootOf = (body: unknown): Record<string, unknown> | null => {
	if (body == null || typeof body !== 'object' || Array.isArray(body)) {
		return null
	}
	const root = (body as { root?: unknown }).root
	return root != null && typeof root === 'object' ? (root as Record<string, unknown>) : null
}

/**
 * Serialize an action's `body` config into HTML. A legacy string body is interpolated as-is
 * (pre-richText behavior, no escaping); a Lexical state walks the converter registry; a Slate
 * array uses the minimal legacy serializer; anything else yields `''`. Rendered text is
 * HTML-escaped and supports `{{ name|fallback }}`, `{{*}}`, and `{{*:table}}` tokens.
 */
export const serializeBody = (body: unknown, ctx: BodyContext): string => {
	if (typeof body === 'string') {
		return interpolate(body, resolverFor(ctx.values))
	}
	const render = renderFor(ctx)
	if (Array.isArray(body)) {
		return serializeSlate(body, render)
	}
	const root = lexicalRootOf(body)
	if (root) {
		const converters = { ...defaultBodyConverters, ...(ctx.converters ?? {}) }
		return serializeNodes(Array.isArray(root.children) ? root.children : [], converters, render)
	}
	return ''
}

/** Build the `renderBody` passed to actions, honoring a plugin-level `richText` customization. */
export const makeRenderBody =
	({ richText, ...args }: Omit<SerializeBodyArgs, 'body'> & { richText?: RichTextBodyOption }) =>
	async (body: unknown): Promise<string> => {
		if (richText?.serialize) {
			return await richText.serialize({ ...args, body })
		}
		return serializeBody(body, {
			values: args.values,
			descriptors: args.descriptors,
			converters: richText?.converters,
		})
	}
