export type { SipgateAccess, SipgateAccessFn, SipgatePluginOptions } from '../index'

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
