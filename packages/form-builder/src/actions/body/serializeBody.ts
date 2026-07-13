import { interpolate } from '../../recall/interpolate'
import type { SubmissionDescriptor, SubmissionValue } from '../../submissions/types'
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

/** Args a custom `richText.serialize` replacement receives per rendered body. */
export type SerializeBodyArgs = {
	body: unknown
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
}

/**
 * Customizes how action bodies become channel-ready strings. `converters` spread over the
 * defaults per Lexical node type; `serialize` replaces the whole pipeline (for non-HTML
 * channels like chat or plain text).
 */
export type RichTextBodyOption = {
	converters?: Record<string, BodyConverter>
	serialize?: (args: SerializeBodyArgs) => Promise<string> | string
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
	(args: {
		values: SubmissionValue[]
		descriptors: SubmissionDescriptor[]
		richText?: RichTextBodyOption
	}) =>
	async (body: unknown): Promise<string> => {
		if (args.richText?.serialize) {
			return await args.richText.serialize({
				body,
				values: args.values,
				descriptors: args.descriptors,
			})
		}
		return serializeBody(body, {
			values: args.values,
			descriptors: args.descriptors,
			converters: args.richText?.converters,
		})
	}
