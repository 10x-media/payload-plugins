import { describe, expect, it } from 'vitest'
import { parseFormBody } from './parseFormBody'

describe('parseFormBody', () => {
	it('maps scalar keys to strings', () => {
		expect(parseFormBody('event=newCall&callId=abc')).toEqual({
			event: 'newCall',
			callId: 'abc',
		})
	})

	it('maps keys ending in [] to arrays', () => {
		expect(parseFormBody('userId[]=w0&userId[]=w1')).toEqual({
			'userId[]': ['w0', 'w1'],
		})
	})

	it('maps a single [] key to a one-element array', () => {
		expect(parseFormBody('userId[]=w0')).toEqual({
			'userId[]': ['w0'],
		})
	})

	it('maps repeated non-[] keys to arrays', () => {
		expect(parseFormBody('tag=a&tag=b')).toEqual({
			tag: ['a', 'b'],
		})
	})
})
