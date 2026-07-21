import { describe, expect, it } from 'vitest'
import { normalizePbxCallRecord } from './wildixPbxHistory'

describe('normalizePbxCallRecord', () => {
	it('maps an answered outbound call for an extension', () => {
		const entry = normalizePbxCallRecord(
			{
				id: '8455',
				start: '2026-07-20 19:36:27',
				timezone: '-0400',
				from_number: '204',
				to_number: '0018292303822',
				disposition: 'ANSWERED',
				billsec: '257',
				duration: '267',
				channel: 'SIP/204-0000028a',
				type: 'call',
			},
			'204'
		)

		expect(entry).toMatchObject({
			callId: '8455',
			callType: 'out',
			callStatus: 'completed',
			callDuration: 257,
			fromNumber: '204',
			toNumber: '0018292303822',
		})
	})

	it('maps NO ANSWER as missed inbound when the extension is the destination', () => {
		const entry = normalizePbxCallRecord(
			{
				id: '8457',
				start: '2026-07-20 20:08:37',
				from_number: '+18496276463',
				to_number: '203',
				disposition: 'NO ANSWER',
				billsec: '0',
				duration: '23',
				type: 'call',
			},
			'203'
		)

		expect(entry).toMatchObject({
			callType: 'in',
			callStatus: 'missed',
			callDuration: 23,
		})
	})

	it('drops fax records', () => {
		expect(normalizePbxCallRecord({ id: '1', type: 'fax' })).toBeNull()
	})
})
