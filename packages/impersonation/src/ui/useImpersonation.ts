'use client'

import { useConfig } from '@payloadcms/ui'
import type { Where } from 'payload'

import type { FailureCode } from '../endpoints/codes'
import type { ImpersonationStatus } from '../getImpersonation'
import { errorKey, goAfterSwitch, postImpersonation } from './api'
import { useImpersonationClient } from './ImpersonationConfig'

export type UseImpersonation = {
	apiPath: string
	cardEmail: boolean
	end: (id: number | string) => Promise<{ error?: FailureCode; ok: boolean; status: number }>
	exit: () => Promise<{ error?: FailureCode; ok: boolean; status: number }>
	reasonMode: 'off' | 'optional' | 'required'
	sessionCollection: string
	setStatus: (status: ImpersonationStatus) => void
	start: (args: {
		collection: string
		id: number | string
		reason?: string
		redirect?: string
	}) => Promise<{ error?: FailureCode; ok: boolean; redirect?: string; status: number }>
	status: ImpersonationStatus
	targets: Record<string, true | Where>
}

/**
 * Headless client API. The provider is always registered, so this works from
 * any admin component. Built-in switcher, bar, and document button use it.
 */
export const useImpersonation = (): UseImpersonation => {
	const plugin = useImpersonationClient()
	const { config } = useConfig()
	const apiPath = plugin?.apiPath ?? `${config.routes.api}/impersonation`
	const reasonMode = plugin?.reasonMode ?? 'off'
	const sessionCollection = plugin?.sessionCollection ?? 'impersonation-sessions'
	const targets = plugin?.targets ?? {}
	const cardEmail = plugin?.cardEmail ?? true
	const status = plugin?.status ?? { active: false }
	const setStatus = plugin?.setStatus ?? (() => undefined)

	return {
		apiPath,
		cardEmail,
		end: (id) => postImpersonation(`${apiPath}/${encodeURIComponent(String(id))}/end`, {}),
		exit: () => postImpersonation(`${apiPath}/exit`, {}),
		reasonMode,
		sessionCollection,
		setStatus,
		start: (args) => postImpersonation(`${apiPath}/start`, args),
		status,
		targets,
	}
}

export { errorKey, goAfterSwitch, postImpersonation }
