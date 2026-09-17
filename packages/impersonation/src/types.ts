import type { Access, CollectionSlug, Payload, PayloadRequest, TypedUser } from 'payload'

import type { TranslationsOption } from './translations'

export type ImpersonationMode = 'parallel' | 'swap'

export type EndedBy =
	| 'exit'
	| 'expired'
	| 'failed'
	| 'impersonatorGone'
	| 'logout'
	| 'targetGone'
	| 'terminated'

export type { FailureCode } from './endpoints/codes'

export type ImpersonationActor = {
	id: number | string
	impersonator: { collection: string; id: number | string }
	mode: ImpersonationMode
	reason?: null | string
	startedAt: string
}

export type ImpersonateAccessArgs = {
	req: PayloadRequest
	target: Record<string, unknown>
	targetCollection: CollectionSlug
}

/**
 * Host gate for starting a session. Only the literal `true` allows. `false`,
 * `undefined`, and a Payload `Where` object all deny. A `Where` is never treated
 * as allow-all.
 */
export type ImpersonateAccess = (
	args: ImpersonateAccessArgs
) => boolean | Promise<boolean | unknown> | unknown

export type BooleanAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

export type IssuedSession = {
	cookie: string
	cookieName: string
	exp: number
	mode: ImpersonationMode
	sid: string
	token: string
	user: TypedUser
}

export type SessionIssueArgs = {
	collection: CollectionSlug
	payload: Payload
	req: PayloadRequest
	userId: number | string
}

export type SessionRevokeArgs = {
	collection: CollectionSlug
	payload: Payload
	req?: PayloadRequest
	sid: string
	userId: number | string
}

export type SessionSeams = {
	/** Defaults to `user._sid`. */
	binding?: (user: TypedUser) => string | undefined
	issue?: (args: SessionIssueArgs) => Promise<IssuedSession>
	revoke?: (args: SessionRevokeArgs) => Promise<void>
}

export type UiOptions = {
	bar?: boolean
	documentAction?: boolean
	headerAction?: boolean
	recordAction?: boolean
}

export type EnabledOptions = {
	access: {
		impersonate: ImpersonateAccess
		readRecords?: Access
		terminate?: BooleanAccess
	}
	apiPath?: string
	collectionSlug?: string
	cookies?: { clearOnSwitch?: string[] }
	decorateRequests?: boolean
	hintCookieName?: string
	maxDuration?: number
	onEnd?: (args: {
		endedBy: EndedBy
		payload: Payload
		record: Record<string, unknown>
		req?: PayloadRequest
	}) => Promise<void> | void
	onStart?: (args: {
		payload: Payload
		record: Record<string, unknown>
		req: PayloadRequest
	}) => Promise<void> | void
	reason?: 'off' | 'optional' | 'required'
	security?: { trustedOrigins?: string[] }
	session?: SessionSeams
	targets?: CollectionSlug[]
	translations?: TranslationsOption
	ui?: false | UiOptions
}

export type ImpersonationPluginOptions =
	| ({ disabled: true } & Partial<EnabledOptions>)
	| ({ disabled?: false } & EnabledOptions)

export type ResolvedUi = {
	bar: boolean
	documentAction: boolean
	headerAction: boolean
	recordAction: boolean
}

export type ResolvedOptions = {
	access: {
		impersonate: ImpersonateAccess
		readRecords: Access
		terminate: BooleanAccess
	}
	apiPath: string
	collectionSlug: CollectionSlug
	cookies: { clearOnSwitch: string[] }
	decorateRequests: boolean
	hintCookieName: string
	maxDuration: number | undefined
	onEnd?: EnabledOptions['onEnd']
	onStart?: EnabledOptions['onStart']
	reason: 'off' | 'optional' | 'required'
	security: { trustedOrigins: string[] }
	session: SessionSeams
	targets: CollectionSlug[] | undefined
	ui: ResolvedUi
}

/** Runtime fields Payload paints on `req.user` but generated collection types omit. */
export type ImpersonatedUser = TypedUser & {
	_impersonation?: ImpersonationActor
	_sid?: string
	_strategy?: string
}

export const asAuthUser = (user: TypedUser): ImpersonatedUser => user as ImpersonatedUser

/** Sid the current request is bound to. Host `session.binding` wins over `_sid`. */
export const boundSid = (
	user: null | TypedUser | undefined,
	binding?: (user: TypedUser) => string | undefined
): string | undefined => {
	if (!user) {
		return undefined
	}
	return binding?.(user) ?? asAuthUser(user)._sid
}

export type ImpersonationRecord = {
	absoluteExpiresAt?: null | string
	endedAt?: null | string
	endedBy?: EndedBy | null
	id: number | string
	impersonator: { relationTo: string; value: number | string } | number | string
	impersonatorEmail?: null | string
	impersonatorLocale?: null | string
	impersonatorSid: string
	ip?: null | string
	mode: ImpersonationMode
	reason?: null | string
	startedAt: string
	target: { relationTo: string; value: number | string } | number | string
	targetEmail?: null | string
	targetLocked?: boolean | null
	targetSid: string
	userAgent?: null | string
}
