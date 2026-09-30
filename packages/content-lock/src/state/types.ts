/** How a window ends: by a person pressing "End now", or at `endsAt`. */
export type EndMode = 'manual' | 'at'

/** What a window freezes: every covered entity, or the listed targets. */
export type ScopeMode = 'everything' | 'selected'

/** A window's lifecycle position, derived from its timestamps and `now`. */
export type WindowStatus = 'pending' | 'announced' | 'active' | 'ended'

/**
 * Something a lock can cover: a collection or global, which the lock freezes,
 * or a custom target, which it only reports for project code to honour.
 */
export type EntityRef = { type: 'collection' | 'global' | 'custom'; slug: string }

/** A collection, global or custom target, as the server helpers name it. */
export type ContentLockTarget = { collection: string } | { global: string } | { custom: string }

/**
 * One lock window as the runtime sees it. Timestamps are ISO strings so the
 * value survives `payload.kv` and the RSC to client boundary unchanged.
 * `targets` holds `group:<key>`, `collection:<slug>` and `global:<slug>` refs.
 */
export type LockWindow = {
	id: string
	title: string
	announceAt: string | null
	startsAt: string
	endMode: EndMode
	endsAt: string | null
	endedAt: string | null
	scope: ScopeMode
	targets: string[]
}

/** A configured group of collections, globals and custom targets, frozen together under one label. */
export type LockGroup = {
	key: string
	label: string | Record<string, string>
	collections: string[]
	globals: string[]
	custom: string[]
}

/** Entities a scope covers. `everything` short-circuits the lists. */
export type ResolvedScope =
	| { everything: true }
	| { everything: false; collections: string[]; globals: string[]; custom: string[] }

/** The effective lock at one instant, merged over every window. Serializable. */
export type ContentLockState = {
	/** Whether any window is active. */
	locked: boolean
	/** Union of the active windows' scopes. */
	scope: ResolvedScope
	/** Latest end of the active windows, or `null` when any of them ends manually. */
	endsAt: string | null
	/** Active windows, in snapshot order. */
	active: LockWindow[]
	/** Announced (scheduled, not yet active) windows, in snapshot order. */
	announced: LockWindow[]
	/** The instant this state was resolved for, ISO. */
	resolvedAt: string
	/** Collection and global slugs no lock freezes. */
	exempt: string[]
}
