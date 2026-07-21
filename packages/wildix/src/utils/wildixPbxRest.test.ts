import { describe, expect, it } from 'vitest'
import {
	normalizePbxDevice,
	normalizePbxSipRegistration,
	normalizePbxSipRegistrations,
} from './wildixPbxRest'

describe('normalizePbxDevice', () => {
	it('maps a device with a mac address and assigned user', () => {
		const device = normalizePbxDevice({
			id: 1234567,
			mac: '9c7514028f24',
			model: 'Phone',
			description: 'desk phone',
			user: '204',
			state: 'on',
			vendor: { name: 'Yealink', additional: '' },
		})

		expect(device).toEqual({
			wildixId: '1234567',
			contact: '9c7514028f24',
			userAgent: 'Phone - Yealink - desk phone',
			online: true,
			extension: '204',
		})
	})

	it('falls back to the device id for contact and userAgent when no mac/model', () => {
		const device = normalizePbxDevice({ id: 42, state: 'off' })

		expect(device).toMatchObject({
			wildixId: '42',
			contact: '42',
			userAgent: '42',
			online: false,
			extension: undefined,
		})
	})

	it('treats a blank user as no linked extension', () => {
		const device = normalizePbxDevice({ id: 7, user: '   ', state: 'on' })
		expect(device?.extension).toBeUndefined()
	})

	it('returns null when the record has no id', () => {
		expect(normalizePbxDevice({ id: undefined as unknown as number })).toBeNull()
	})
})

describe('normalizePbxSipRegistration', () => {
	it('maps a WebRTC softphone registration', () => {
		const device = normalizePbxSipRegistration('204', {
			online: '1',
			contact: 'sip:204@46.224.213.36:45717;transport=ws',
			instance: '<urn:uuid:bd75011e-19cd-dcb3-9027-8fefd6995a4c>',
			useragent: 'Wildix Zero Distance 4.0.1 WebRTC-ae97fcc6',
		})

		expect(device).toEqual({
			wildixId: 'sip:204:urn:uuid:bd75011e-19cd-dcb3-9027-8fefd6995a4c',
			contact: 'sip:204@46.224.213.36:45717;transport=ws',
			userAgent: 'Wildix Zero Distance 4.0.1 WebRTC-ae97fcc6',
			online: true,
			extension: '204',
		})
	})

	it('falls back to the contact in wildixId when instance is absent', () => {
		const contact = 'sip:201@10.0.0.1:5060'
		const device = normalizePbxSipRegistration('201', { online: '0', contact })
		expect(device).toMatchObject({
			wildixId: `sip:201:${contact}`,
			online: false,
			userAgent: contact,
		})
	})

	it('returns null when contact is missing', () => {
		expect(normalizePbxSipRegistration('204', { online: '1' })).toBeNull()
	})
})

describe('normalizePbxSipRegistrations', () => {
	it('flattens the per-extension map', () => {
		const devices = normalizePbxSipRegistrations({
			'204': {
				registrations: [{ online: '1', contact: 'sip:204@a', instance: 'inst-a', useragent: 'A' }],
			},
			'201': {
				registrations: [{ online: '0', contact: 'sip:201@b', useragent: 'B' }],
			},
		})
		expect(devices).toHaveLength(2)
		expect(devices.map((d) => d.extension).sort()).toEqual(['201', '204'])
	})
})
