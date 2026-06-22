import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { defaultIdentify } from './identify'

const req = (headers: Record<string, string>, user?: { id: string | number }): PayloadRequest =>
	({ headers: new Headers(headers), user: user ?? null }) as unknown as PayloadRequest

describe('defaultIdentify', () => {
	const identify = defaultIdentify('x-forwarded-for')

	it('prefers an authenticated user id', () => {
		expect(identify(req({ 'x-forwarded-for': '1.2.3.4' }, { id: 7 }))).toBe('user:7')
	})

	it('falls back to the first hop of the trusted header', () => {
		expect(identify(req({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).toBe('ip:9.9.9.9')
	})

	it('returns null when there is no user and no header', () => {
		expect(identify(req({}))).toBeNull()
	})

	it('honors a custom header name', () => {
		expect(defaultIdentify('cf-connecting-ip')(req({ 'cf-connecting-ip': '5.5.5.5' }))).toBe(
			'ip:5.5.5.5'
		)
	})
})
