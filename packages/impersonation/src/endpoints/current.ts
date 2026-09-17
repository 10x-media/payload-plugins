import type { Endpoint, PayloadRequest } from 'payload'

import { closeAndRevoke } from '../session/close'
import { isPastAbsoluteExpiry, relationOf, resolveCurrent } from '../session/resolve'
import { boundSid } from '../types'
import { getOptions, json } from './shared'

export const currentHandler = async (req: PayloadRequest): Promise<Response> => {
	const options = getOptions(req)
	const user = req.user
	const sid = boundSid(user, options.session.binding)
	if (!user || !sid) {
		return json({ body: { active: false }, req, status: 200 })
	}

	const row = await resolveCurrent({
		headers: req.headers,
		options,
		payload: req.payload,
		req,
		sid,
	})
	if (!row || isPastAbsoluteExpiry(row)) {
		if (row && isPastAbsoluteExpiry(row)) {
			await closeAndRevoke({
				endedBy: 'expired',
				options,
				payload: req.payload,
				record: row,
				req,
			})
		}
		return json({ body: { active: false }, req, status: 200 })
	}

	const impersonator = relationOf(row.impersonator)
	const target = relationOf(row.target)

	return json({
		body: {
			absoluteExpiresAt: row.absoluteExpiresAt ?? null,
			active: true,
			impersonator,
			impersonatorLocale: row.impersonatorLocale ?? null,
			mode: row.mode,
			startedAt: row.startedAt,
			target,
		},
		req,
		status: 200,
	})
}

export const currentEndpoint = (path: string): Endpoint => ({
	handler: currentHandler,
	method: 'get',
	path,
})
