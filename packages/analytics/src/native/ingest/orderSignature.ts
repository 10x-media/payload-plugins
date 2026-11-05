import type { Payload } from 'payload'
import { ITEM_SIGNATURE_SEPARATOR } from '../../goals/constants'
import type { OrderSignatureMode } from '../../goals/match'
import { isSignatureShaped } from '../../items/ref'
import { sanitizeOrderId } from './revenue'
import { labelledKey, sameSignature, shortSignature } from './signature'

/** What ingest checks a page's order id against; without a key no signature is ever valid. */
export interface OrderSignatureCheck {
	mode: OrderSignatureMode
	key?: Buffer
}

/** The key order ids are signed with, derived from the instance's secret. */
export const orderRefKey = labelledKey('analytics:order-ref:v1')

/** The signature of one order id in one scope. */
const signatureOf = (key: Buffer, scope: string, orderId: string): string =>
	shortSignature(key, JSON.stringify([scope, orderId]))

interface SignedOrderId {
	orderId: string
	signature: string
}

/** A value split at its last separator when what follows it has a signature's shape. */
const splitSigned = (value: string): SignedOrderId | undefined => {
	const at = value.lastIndexOf(ITEM_SIGNATURE_SEPARATOR)
	const signature = at > 0 ? value.slice(at + 1) : ''
	return isSignatureShaped(signature) ? { orderId: value.slice(0, at), signature } : undefined
}

const signedWith = (key: Buffer, scope: string, signed: SignedOrderId): boolean =>
	sameSignature(signatureOf(key, scope, signed.orderId), signed.signature)

/** A page's order id as ingest keeps it, or a refusal: ingest drops the sale and answers 202. */
type WireOrderId = { ok: true; orderId?: string } | { ok: false }

const sanitizedOrderId = (value: unknown): WireOrderId => {
	const orderId = sanitizeOrderId(value)
	return orderId === undefined ? { ok: false } : { ok: true, orderId }
}

/**
 * Id unwrapped from a reference signed for the event's scope, else the raw value while signatures
 * are optional. Refuses a malformed id and, when signatures are required, an unsigned one.
 */
export const wireOrderId = (
	value: unknown,
	scope: string,
	check: OrderSignatureCheck | undefined
): WireOrderId => {
	if (value === undefined) {
		return { ok: true }
	}
	const signed = typeof value === 'string' ? splitSigned(value) : undefined
	if (signed && check?.key && signedWith(check.key, scope, signed)) {
		return sanitizedOrderId(signed.orderId)
	}
	if (check?.mode === 'required') {
		return { ok: false }
	}
	return sanitizedOrderId(value)
}

/**
 * `orderId` for the browser `purchase` (`<orderId>@<signature>`), bound to the tenant `scope`.
 * Call it where the success page renders; the browser never sees the key.
 */
export const signOrderId = (
	payload: Payload,
	orderId: string,
	opts: { scope?: string | null } = {}
): string | undefined => {
	const id = sanitizeOrderId(orderId)
	const secret: unknown = payload.secret
	if (id === undefined || typeof secret !== 'string' || secret === '') {
		return undefined
	}
	const signature = signatureOf(orderRefKey(secret), opts.scope ?? '', id)
	return `${id}${ITEM_SIGNATURE_SEPARATOR}${signature}`
}
