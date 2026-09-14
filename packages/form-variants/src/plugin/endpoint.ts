import {
	addDataAndFileToRequest,
	type CollectionSlug,
	docAccessOperation,
	type Endpoint,
	headersWithCors,
	type JsonObject,
	type PayloadRequest,
} from 'payload'
import { hasDraftsEnabled } from 'payload/shared'

import {
	buildContext,
	evaluateVisibility,
	passesAccess,
	runAfterSave,
	runGate,
	withValues,
} from '../server/evaluate'
import type { AfterSaveAction, GateResult, WizardState } from '../types'
import { EVALUATE_PATH } from './constants'
import { getCollectionVariants } from './registry'

/** What the browser sends. Everything here is client input. */
export type EvaluateRequest = {
	collection: string
	/** The document id. Required for `afterSave`, where it is the id of the saved document. */
	id?: number | string
	inDrawer?: boolean
	/**
	 * `afterSave` only: `create` when the save created the document. The id exists by then, so
	 * the server cannot tell on its own; the claim only switches the permission checked from
	 * update to create and the `operation` the hook sees.
	 */
	operation?: 'create' | 'update'
	phase: 'afterSave' | 'gate' | 'visibility'
	state?: WizardState
	step?: string
	values?: JsonObject
	variant: string
}

export type EvaluateResponse = {
	action?: AfterSaveAction
	gate?: GateResult
	visible: string[]
}

const json = (req: PayloadRequest, body: unknown, status = 200): Response =>
	Response.json(body, { headers: headersWithCors({ headers: new Headers(), req }), status })

const readBody = (req: PayloadRequest): EvaluateRequest | null => {
	const data = req.data as Partial<EvaluateRequest> | undefined
	if (!data || typeof data.collection !== 'string' || typeof data.variant !== 'string') {
		return null
	}
	if (data.phase !== 'afterSave' && data.phase !== 'gate' && data.phase !== 'visibility') {
		return null
	}
	if (data.operation !== undefined && data.operation !== 'create' && data.operation !== 'update') {
		return null
	}
	if (data.phase === 'afterSave' && !data.id) {
		return null
	}
	return data as EvaluateRequest
}

/**
 * Whether a published version exists, the way Payload's document view computes it. Without
 * drafts every existing document counts as published.
 */
const getHasPublishedDoc = async (
	req: PayloadRequest,
	slug: CollectionSlug,
	id: number | string | undefined
): Promise<boolean> => {
	if (!id) {
		return false
	}
	const collection = req.payload.collections[slug]?.config
	if (!collection || !hasDraftsEnabled(collection)) {
		return true
	}
	const published = await req.payload.findVersions({
		collection: slug,
		depth: 0,
		limit: 1,
		req,
		where: {
			and: [{ parent: { equals: id } }, { 'version._status': { equals: 'published' } }],
		},
	})
	return published.totalDocs > 0
}

/**
 * The plugin's one server transport. Loads the document with access enforced, answers 403
 * without update access (create access when there is no id yet, or after a save that created
 * the document), re-checks the variant's `access`, and only then runs the step logic the
 * phase names. `afterSave` gets the document as the server reads it, never the browser's copy.
 */
export const buildEvaluateEndpoint = (): Endpoint => ({
	handler: async (req) => {
		if (!req.user) {
			return json(req, { message: 'Unauthorized' }, 401)
		}
		await addDataAndFileToRequest(req)
		const body = readBody(req)
		if (!body) {
			return json(req, { message: 'Bad request' }, 400)
		}

		const slug = body.collection as CollectionSlug
		const resolved = getCollectionVariants(req.payload.config, slug)
		const collection = req.payload.collections[slug]
		if (!resolved || !collection) {
			return json(req, { message: 'Unknown collection' }, 404)
		}
		const variant = resolved.variants.find((candidate) => candidate.key === body.variant)
		if (!variant || variant.native) {
			return json(req, { message: 'Unknown variant' }, 404)
		}

		const id = body.id
		const operation =
			!id || (body.phase === 'afterSave' && body.operation === 'create') ? 'create' : 'update'
		const permissions = await docAccessOperation({ collection, id, req })
		if (operation === 'create' ? !permissions.create : !permissions.update) {
			return json(req, { message: 'Forbidden' }, 403)
		}

		const doc = id
			? ((await req.payload.findByID({
					collection: slug,
					depth: 0,
					disableErrors: true,
					draft: true,
					id,
					overrideAccess: false,
					req,
				})) as JsonObject | null)
			: null
		if (id && !doc) {
			return json(req, { message: 'Not found' }, 404)
		}

		const ctx = buildContext({
			doc,
			hasPublishedDoc: await getHasPublishedDoc(req, slug, id),
			inDrawer: body.inDrawer === true,
			operation,
			req,
		})
		if (!(await passesAccess(variant, ctx))) {
			return json(req, { message: 'Forbidden' }, 403)
		}

		const stepCtx = withValues(ctx, body.values, body.state)
		const visible = await evaluateVisibility(variant, stepCtx)
		const response: EvaluateResponse = { visible }

		if (body.phase === 'gate') {
			const step = variant.steps.find((candidate) => candidate.key === body.step)
			if (!step) {
				return json(req, { message: 'Unknown step' }, 404)
			}
			response.gate = await runGate(step, stepCtx)
		}

		if (body.phase === 'afterSave' && doc) {
			response.action = await runAfterSave(variant, ctx, doc)
		}

		return json(req, response)
	},
	method: 'post',
	path: EVALUATE_PATH,
})
