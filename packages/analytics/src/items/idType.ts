/**
 * A bound collection's id shape per config. Where the adapter casts ids (Mongo, Postgres), a query
 * naming an id of another shape fails as a whole rather than matching nothing.
 */
export type ItemIdType = 'objectId' | 'serial' | 'number' | 'uuid' | 'text'

const OBJECT_ID = /^[0-9a-f]{24}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Postgres `serial` is a 4-byte integer column, and a value outside it fails the cast. */
const INT4_MIN = -2_147_483_648
const INT4_MAX = 2_147_483_647

/** The number an id spells, when it spells it the one way `String(number)` writes it. */
const canonicalNumber = (id: string): number | undefined => {
	const n = Number(id)
	return Number.isFinite(n) && String(n) === id ? n : undefined
}

/**
 * Whether a decoded id could be one of a collection's ids, spelled as the database returns them.
 * Not Payload's `isValidID`, which takes any 12-character string as an ObjectId and knows no uuid.
 */
export const fitsIdType = (id: string, type: ItemIdType): boolean => {
	switch (type) {
		case 'objectId':
			return OBJECT_ID.test(id)
		case 'uuid':
			return UUID.test(id)
		case 'serial': {
			const n = canonicalNumber(id)
			return n !== undefined && Number.isInteger(n) && n >= INT4_MIN && n <= INT4_MAX
		}
		case 'number':
			return canonicalNumber(id) !== undefined
		case 'text':
			return id !== ''
	}
}
