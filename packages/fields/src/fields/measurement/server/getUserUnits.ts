import type { PayloadRequest } from 'payload'
import { memoForRequest } from '../../../utils/memoForRequest'
import { MEASUREMENT_PREFERENCE_KEY, type MeasurementUnitsPreference } from '../options'

const USER_UNITS_MEMO = Symbol('measurementField:userUnits')

const isPreference = (value: unknown): value is MeasurementUnitsPreference =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The viewer's saved unit map, one query per request however many measurement
 * fields the document renders. Mirrors Payload's own server-side preference
 * lookup (packages/next getPreferences): find on payload-preferences by key
 * and polymorphic user.
 */
export const getUserMeasurementUnits = (
	req: PayloadRequest
): Promise<MeasurementUnitsPreference | null> => {
	const { user } = req
	if (!user) return Promise.resolve(null)
	return memoForRequest(req, USER_UNITS_MEMO, async () => {
		try {
			const result = await req.payload.find({
				collection: 'payload-preferences',
				depth: 0,
				limit: 1,
				pagination: false,
				sort: '-updatedAt',
				where: {
					and: [
						{ key: { equals: MEASUREMENT_PREFERENCE_KEY } },
						{ 'user.value': { equals: user.id } },
						{ 'user.relationTo': { equals: user.collection } },
					],
				},
			})
			const value = result.docs[0]?.value
			return isPreference(value) ? value : null
		} catch (error) {
			req.payload.logger.error({ err: error }, '[fields] measurement preference read failed')
			return null
		}
	})
}
