import type { PayloadRequest } from 'payload'

/** A Local API call reusing a request may swap its user, and an answer is about one user. */
export const userKey = (req: PayloadRequest): string =>
	req.user ? `${String(req.user.collection)}:${String(req.user.id)}` : '-'

interface RequestMemoEntry<T> {
	/** Whatever answers it, the runtime or a host function: two owners never share an answer. */
	owner: object
	/** What is being answered, unique per owner. */
	key: string
	compute: () => T | Promise<T>
}

/** Answers one memo entry, computing it only the first time this request and user ask. */
type RequestMemo<T> = (req: PayloadRequest, entry: RequestMemoEntry<T>) => Promise<T>

/**
 * Memo kept on the request, not a module map, so the `.` and `/rsc` bundles share one answer via
 * `Symbol.for`. Computed once per owner, key and user; a rejection rejects every caller alike.
 */
export const requestMemo = <T>(name: string): RequestMemo<T> => {
	const slot = Symbol.for(`@10x-media/analytics/${name}`)
	const ownersOf = (req: PayloadRequest): WeakMap<object, Map<string, Promise<T>>> => {
		const existing: unknown = Reflect.get(req, slot)
		if (existing instanceof WeakMap) {
			return existing
		}
		const created = new WeakMap<object, Map<string, Promise<T>>>()
		Reflect.set(req, slot, created)
		return created
	}
	return (req, { owner, key, compute }) => {
		const owners = ownersOf(req)
		let owned = owners.get(owner)
		if (!owned) {
			owned = new Map()
			owners.set(owner, owned)
		}
		const id = `${key}|${userKey(req)}`
		const known = owned.get(id)
		if (known) {
			return known
		}
		const answer = (async () => compute())()
		owned.set(id, answer)
		return answer
	}
}
