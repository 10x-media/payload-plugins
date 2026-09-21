import type { Access, CollectionSlug, Payload, PayloadRequest, TypedUser, Where } from 'payload'

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
	absoluteExpiresAt?: null | string
	id: number | string
	impersonator: { collection: string; id: number | string }
	mode: ImpersonationMode
	reason?: null | string
	startedAt: string
	target: { collection: string; id: number | string }
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

/**
 * Which users the switcher (and document action) should offer. This is UX only.
 * `access.impersonate` remains the start check. The result is sent to the client,
 * so a caller can still POST `/start` for someone outside the filter; start
 * re-runs this function and rejects a miss.
 *
 * - `true`: list the whole collection
 * - `false`: hide the collection
 * - `Where`: AND this query onto the list fetch
 */
export type FilterTargets = (args: {
	req: PayloadRequest
	targetCollection: CollectionSlug
}) => boolean | Promise<boolean | Where> | Where

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
	/**
	 * Admin bar while a session is open. Target side: "Acting as" / "Return to".
	 * Parallel impersonator side: "session is active on the website" / "End session".
	 * @default true
	 */
	bar?: boolean
	/**
	 * Show email under `useAsTitle` on default switcher cards. Hidden when the
	 * title is already the email.
	 * @default true
	 */
	cardEmail?: boolean
	/**
	 * Impersonate button on the target document. Rendered in
	 * `BeforeDocumentControls` so it stays visible when the edit-menu dots are
	 * hidden (no create/delete access).
	 * @default true
	 */
	documentAction?: boolean
	/**
	 * Header control that opens the user switcher drawer.
	 * @default true
	 */
	headerAction?: boolean
	/**
	 * "End session" on an `impersonation-sessions` document. The collection is
	 * hidden and read-only by default, so this only appears if you un-hide it
	 * and grant create or delete (Payload hides the dots menu otherwise).
	 * @default true
	 */
	recordAction?: boolean
}

export type RetentionOptions = {
	/** Closed rows older than this many days are deleted. Open rows are never deleted. */
	deleteAfterDays: number
	/** @default `0 3 * * *` */
	cron?: string
	/** @default `impersonation-retention` */
	queue?: string
}

export type EnabledOptions = {
	access: {
		/**
		 * Gate for POST `/start`. Only the literal `true` allows. A `Where` object
		 * is deny, never allow-all.
		 */
		impersonate: ImpersonateAccess
		/** Who can list `impersonation-sessions`. Default deny. The collection is hidden. */
		readRecords?: Access
		/** Who can POST `/end` on someone else's session. Default deny. */
		terminate?: BooleanAccess
		/**
		 * Who the switcher lists. Omit to show everyone the viewer can read.
		 * See {@link FilterTargets}.
		 */
		filterTargets?: FilterTargets
	}
	apiPath?: string
	collectionSlug?: string
	cookies?: { clearOnSwitch?: string[] }
	decorateRequests?: boolean
	hintCookieName?: string
	maxDuration?: number
	/**
	 * Opt-in cleanup of closed rows, plus `closeStaleImpersonations` on the same
	 * cron. Off until you set this. The host must run the queue (`jobs.autoRun`
	 * or a bin). Open rows are never deleted.
	 */
	retention?: false | RetentionOptions
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
	cardEmail: boolean
	documentAction: boolean
	headerAction: boolean
	recordAction: boolean
}

export type ResolvedOptions = {
	access: {
		filterTargets?: FilterTargets
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
	retention: RetentionOptions | undefined
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
	impersonatorTenantCookie?: null | string
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
