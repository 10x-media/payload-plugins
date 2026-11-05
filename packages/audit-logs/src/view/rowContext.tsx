'use client'

import { createContext, useContext } from 'react'

import type { AuditLogRowState } from '../types'

const RowContext = createContext<AuditLogRowState | null>(null)

/** Wraps one row, so the client components its slots render can reach its state. */
export const AuditLogRowProvider = RowContext.Provider

/**
 * The state of the row a slot renders in: its entry, and whether it is expanded. Rows
 * start collapsed and every slot is mounted from the start, so this is how a slot puts
 * off work until someone opens its row.
 *
 * Only for client components inside `user`, `rowBadges`, `beforeRowDetails` or
 * `afterRowDetails`. Anywhere else it throws.
 */
export const useAuditLogRow = (): AuditLogRowState => {
	const state = useContext(RowContext)
	if (!state) {
		throw new Error('useAuditLogRow is only available inside a row slot of the audit logs view.')
	}
	return state
}
