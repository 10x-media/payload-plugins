import type { Payload, PayloadRequest, Where } from 'payload'
import { parseCookies } from 'payload/shared'
import { idsEqual } from '../ids'
import type { ImpersonationRecord, ResolvedOptions } from '../types'

export const openByTargetSid = (sid: string): Where => ({
	and: [{ endedAt: { exists: false } }, { targetSid: { equals: sid } }],
})

export const openByImpersonatorSid = (sid: string): Where => ({
	and: [{ endedAt: { exists: false } }, { impersonatorSid: { equals: sid } }],
})

const findOpenWhere = async ({
	options,
	payload,
	req,
	where,
}: {
	options: ResolvedOptions
	payload: Payload
	req?: PayloadRequest
	where: Where
}): Promise<ImpersonationRecord | null> => {
	try {
		const found = await payload.find({
			collection: options.collectionSlug,
			depth: 0,
			limit: 1,
			overrideAccess: true,
			pagination: false,
			req,
			where,
		})
		return (found.docs[0] as unknown as ImpersonationRecord | undefined) ?? null
	} catch {
		// Postgres CASCADE on impersonation_sessions_rels can make payload.find
		// reject a row whose required impersonator or target relationship is gone.
		const found = await payload.db.find({
			collection: options.collectionSlug,
			limit: 1,
			req,
			where,
		})
		return (found.docs[0] as unknown as ImpersonationRecord | undefined) ?? null
	}
}

export const findOpenByTargetSid = async ({
	options,
	payload,
	req,
	sid,
}: {
	options: ResolvedOptions
	payload: Payload
	req?: PayloadRequest
	sid: string
}): Promise<ImpersonationRecord | null> =>
	findOpenWhere({ options, payload, req, where: openByTargetSid(sid) })

export const findOpenByImpersonatorSid = async ({
	options,
	payload,
	req,
	sid,
}: {
	options: ResolvedOptions
	payload: Payload
	req?: PayloadRequest
	sid: string
}): Promise<ImpersonationRecord | null> =>
	findOpenWhere({ options, payload, req, where: openByImpersonatorSid(sid) })

export const openBySid = (sid: string): Where => ({
	and: [
		{ endedAt: { exists: false } },
		{ or: [{ targetSid: { equals: sid } }, { impersonatorSid: { equals: sid } }] },
	],
})

export const findOpenBySid = async (args: {
	options: ResolvedOptions
	payload: Payload
	req?: PayloadRequest
	sid: string
}): Promise<ImpersonationRecord | null> => findOpenWhere({ ...args, where: openBySid(args.sid) })

export const impersonationSide = (
	row: ImpersonationRecord,
	sid: string
): 'impersonator' | 'target' => (row.targetSid === sid ? 'target' : 'impersonator')

const rowMatchesSid = (row: ImpersonationRecord, sid: string): boolean =>
	row.targetSid === sid || row.impersonatorSid === sid

/** Hint cookie is a lookup aid. The open row must still match `sid`. */
export const resolveCurrent = async ({
	headers,
	options,
	payload,
	req,
	sid,
}: {
	headers: Headers
	options: ResolvedOptions
	payload: Payload
	req?: PayloadRequest
	sid: string
}): Promise<ImpersonationRecord | null> => {
	const hint = parseCookies(headers).get(options.hintCookieName)
	if (hint) {
		try {
			const row = (await payload.findByID({
				id: hint,
				collection: options.collectionSlug,
				depth: 0,
				overrideAccess: true,
				req,
			})) as unknown as ImpersonationRecord
			if (row && !row.endedAt && rowMatchesSid(row, sid)) {
				return row
			}
		} catch {
			// Forged or stale hint: fall through to the sid lookup.
		}
	}

	return findOpenBySid({ options, payload, req, sid })
}

export const relationOf = (
	value: ImpersonationRecord['impersonator']
): { collection: string; id: number | string } | null => {
	if (value && typeof value === 'object' && 'relationTo' in value) {
		return { collection: value.relationTo, id: value.value }
	}
	return null
}

export const isPastAbsoluteExpiry = (row: ImpersonationRecord, now = Date.now()): boolean => {
	if (!row.absoluteExpiresAt) {
		return false
	}
	const expires = new Date(row.absoluteExpiresAt).getTime()
	return Number.isFinite(expires) && expires <= now
}

export const sameUser = (
	left: { collection?: string; id?: number | string },
	rightCollection: string,
	rightId: number | string
): boolean =>
	Boolean(left.collection) && left.collection === rightCollection && idsEqual(left.id, rightId)
