import type { Endpoint, PayloadRequest } from 'payload'

import { asId } from '../ids'
import { closeAndRevoke } from '../session/close'
import { releaseLocks } from '../session/locks'
import type { ImpersonationRecord } from '../types'
import { fail, getOptions, isLiteralTrue, json, prepareMutation, rejectGate } from './shared'

export const terminateHandler = async (req: PayloadRequest): Promise<Response> => {
	const gate = await prepareMutation(req)
	if (gate) {
		return rejectGate(req, gate)
	}

	const options = getOptions(req)
	if (!req.user) {
		return fail({ error: 'forbidden', req, status: 403 })
	}

	const allowed = await options.access.terminate({ req })
	if (!isLiteralTrue(allowed)) {
		return fail({ error: 'forbidden', req, status: 403 })
	}

	const id = asId(req.routeParams?.id)
	if (id == null) {
		return fail({ error: 'invalidBody', req, status: 400 })
	}

	let record: ImpersonationRecord
	try {
		record = (await req.payload.findByID({
			id,
			collection: options.collectionSlug,
			depth: 0,
			overrideAccess: true,
			req,
		})) as unknown as ImpersonationRecord
	} catch {
		return fail({ error: 'targetNotFound', req, status: 404 })
	}

	if (record.endedAt) {
		return json({ body: { ok: true }, req, status: 200 })
	}

	const closed = await closeAndRevoke({
		endedBy: 'terminated',
		options,
		payload: req.payload,
		record,
		req,
	})
	await releaseLocks({ payload: req.payload, record: closed, req })
	return json({ body: { ok: true }, req, status: 200 })
}

export const terminateEndpoint = (path: string): Endpoint => ({
	handler: terminateHandler,
	method: 'post',
	path,
})
