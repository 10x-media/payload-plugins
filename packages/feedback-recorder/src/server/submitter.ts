import type { TypedUser } from 'payload'

export type Submitter = {
	id: string
	name: string | null
	email: string | null
	role: string | null
}

const stringField = (user: Record<string, unknown>, key: string): string | null => {
	const value = user[key]
	return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Who sent a recording, as far as this CMS knows them. The id is `<collection>:<id>` so two auth
 * collections cannot collide; the 10x system scopes "my recordings" and per-clip calls by it.
 */
export const submitterFrom = (user: TypedUser): Submitter => {
	const record = user as unknown as Record<string, unknown>
	const fullName = [stringField(record, 'firstName'), stringField(record, 'lastName')]
		.filter(Boolean)
		.join(' ')
	const roles = record.roles
	const role = Array.isArray(roles)
		? roles.filter((entry): entry is string => typeof entry === 'string').join(', ') || null
		: stringField(record, 'role')
	return {
		id: `${user.collection}:${String(user.id)}`,
		name: stringField(record, 'name') ?? (fullName || null),
		email: stringField(record, 'email'),
		role,
	}
}
