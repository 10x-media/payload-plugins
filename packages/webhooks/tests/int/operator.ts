import type { Payload, User } from 'payload'

const operators = new WeakMap<Payload, Promise<User>>()

/**
 * A real admin user for the booted instance, created once per instance.
 *
 * Payload 4 stamps `createdBy` / `updatedBy` from `req.user` on every write and validates the
 * relationship, so a stand-in like `{ id: 'u1', collection: 'users' }` fails the write itself (a
 * BSON cast error on MongoDB). Tests that act as "some signed-in admin" use this one instead.
 */
export const operatorFor = (payload: Payload): Promise<User> => {
	let operator = operators.get(payload)
	if (!operator) {
		operator = payload
			.create({
				collection: 'users',
				data: { email: 'operator@webhooks.test', password: 'operator-password' },
				overrideAccess: true,
			})
			.then((doc) => ({ ...doc, collection: 'users' }) as User)
		operators.set(payload, operator)
	}
	return operator
}
