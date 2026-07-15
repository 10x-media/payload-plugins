export type { WildixAccess, WildixAccessFn, WildixPluginOptions } from '../index'
export type { LiveCallPosition, WildixAuthType, WildixCredentials } from '../types'
export type { SyncResult } from '../utils/wildixSyncHandlers'

export type CallLog = {
	id: string
	callId: string
	callType: 'in' | 'out'
	callStatus: 'ringing' | 'connected' | 'completed' | 'missed' | 'voicemail' | 'rejected'
	callDuration: number
	fromNumber: string
	toNumber: string
	relatedContact?: { relationTo: string; value: string | Record<string, unknown> }
	startedAt?: string
	updatedAt: string
	createdAt: string
}
