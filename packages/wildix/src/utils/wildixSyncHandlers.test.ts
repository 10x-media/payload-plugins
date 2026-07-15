import type { CallRecord } from '@wildix/wda-history-client'
import { describe, expect, it } from 'vitest'
import { normalizeCallHistory } from './wildixSyncHandlers'

const record = (overrides: Partial<CallRecord>): CallRecord =>
	({
		id: 'call-1',
		flowIndex: 0,
		startTime: 1_700_000_000_000,
		endTime: 1_700_000_060_000,
		duration: 60,
		pbx: 'pbx-1',
		time: 1_700_000_000_000,
		company: 'it_test',
		licenses: [],
		type: 'call',
		...overrides,
	}) as unknown as CallRecord

describe('normalizeCallHistory', () => {
	it('maps an inbound completed call to a normalized log', () => {
		const [entry] = normalizeCallHistory([
			record({
				direction: 'INBOUND',
				callStatus: 'COMPLETED',
				talkTime: 42,
				caller: { phone: '+491111' } as never,
				callee: { phone: '+492222' } as never,
			}),
		])

		expect(entry).toMatchObject({
			callId: 'call-1',
			callType: 'in',
			callStatus: 'completed',
			callDuration: 42,
			fromNumber: '+491111',
			toNumber: '+492222',
		})
		expect(entry?.startedAt).toEqual(new Date(1_700_000_000_000))
	})

	it('maps an outbound missed call and falls back to duration when talkTime is absent', () => {
		const [entry] = normalizeCallHistory([
			record({ direction: 'OUTBOUND', callStatus: 'MISSED', duration: 15 }),
		])

		expect(entry).toMatchObject({ callType: 'out', callStatus: 'missed', callDuration: 15 })
	})

	it('treats INTERNAL calls as outbound', () => {
		const [entry] = normalizeCallHistory([record({ direction: 'INTERNAL' })])
		expect(entry?.callType).toBe('out')
	})

	it('defaults an unmapped call status to completed', () => {
		const [entry] = normalizeCallHistory([
			record({ direction: 'INBOUND', callStatus: 'UNKNOWN_STATUS' as never }),
		])
		expect(entry?.callStatus).toBe('completed')
	})

	it('falls back to the destination field when the callee has no phone', () => {
		const [entry] = normalizeCallHistory([record({ direction: 'INBOUND', destination: '+493333' })])
		expect(entry?.toNumber).toBe('+493333')
	})

	it('drops calls with no direction, since they cannot be classified', () => {
		const entries = normalizeCallHistory([record({ direction: undefined })])
		expect(entries).toHaveLength(0)
	})
})
