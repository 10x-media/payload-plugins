import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildAuditConfig } from './auditFields'

const text = (name: string): Field => ({ type: 'text', name }) as Field
const existing: Field[] = [text('title')]

const names = (fields: Field[]): string[] =>
	fields.flatMap((field) => ('name' in field && field.name ? [field.name] : []))

describe('buildAuditConfig', () => {
	it('adds nothing when audit fields are off', () => {
		const built = buildAuditConfig(existing, { auditLog: true }, 'users', undefined)
		expect(names(built.fields)).toEqual(['title'])
		expect(built.hasActiveFields).toBe(false)
		expect(built.createdByHookConfig).toBe(false)
		expect(built.lastModifiedByHookConfig).toBe(false)
	})

	it('appends both fields when asked for both', () => {
		const built = buildAuditConfig(existing, { auditFields: true }, 'users', undefined)
		expect(names(built.fields)).toEqual(['title', 'createdBy', 'lastModifiedBy'])
		expect(built.hasActiveFields).toBe(true)
	})

	it('leaves the incoming field list untouched', () => {
		buildAuditConfig(existing, { auditFields: true }, 'users', undefined)
		expect(names(existing)).toEqual(['title'])
	})

	it('appends only the field that was asked for', () => {
		const built = buildAuditConfig(existing, { auditFields: { createdBy: {} } }, 'users', undefined)
		expect(names(built.fields)).toEqual(['title', 'createdBy'])
		expect(built.lastModifiedByHookConfig).toBe(false)
	})

	it('renames the field and the path the hook writes to', () => {
		const built = buildAuditConfig(
			existing,
			{ auditFields: { createdBy: { name: 'author' } } },
			'users',
			undefined
		)
		expect(names(built.fields)).toEqual(['title', 'author'])
		expect(built.createdByHookConfig).toMatchObject({ path: 'author' })
	})

	describe('manual fields', () => {
		const manual = {
			auditFields: { createdBy: { isManual: true, path: 'meta.author' } },
		} as const

		it('are configured for the hook but not appended, the host declared them', () => {
			const built = buildAuditConfig(existing, manual, 'users', undefined)
			expect(names(built.fields)).toEqual(['title'])
			expect(built.createdByHookConfig).toMatchObject({ path: 'meta.author' })
			expect(built.hasActiveFields).toBe(true)
		})

		it('declare their own polymorphism, nothing can be inferred from a path', () => {
			const built = buildAuditConfig(existing, manual, ['users', 'admins'], undefined)
			expect(built.createdByHookConfig).toMatchObject({ isPolymorphic: false })
		})
	})

	describe('what the field relates to', () => {
		it('follows the host auth collections by default', () => {
			const built = buildAuditConfig(
				existing,
				{ auditFields: true },
				['users', 'admins'],
				undefined
			)
			expect(built.createdByHookConfig).toMatchObject({
				isPolymorphic: true,
				relationTo: ['users', 'admins'],
			})
		})

		it('is a plain id with one auth collection', () => {
			const built = buildAuditConfig(existing, { auditFields: true }, 'users', undefined)
			expect(built.createdByHookConfig).toMatchObject({ isPolymorphic: false, relationTo: 'users' })
		})

		it('honours a per-field override', () => {
			const built = buildAuditConfig(
				existing,
				{ auditFields: { createdBy: { relationTo: 'admins' } } },
				'users',
				undefined
			)
			expect(built.createdByHookConfig).toMatchObject({ relationTo: 'admins' })
		})
	})

	describe('plugin defaults', () => {
		it('apply to a field enabled without options', () => {
			const built = buildAuditConfig(existing, { auditFields: true }, 'users', {
				createdBy: { name: 'creator' },
			})
			expect(names(built.fields)).toEqual(['title', 'creator', 'lastModifiedBy'])
		})

		it('lose to per-entity options', () => {
			const built = buildAuditConfig(
				existing,
				{ auditFields: { createdBy: { name: 'author' } } },
				'users',
				{ createdBy: { name: 'creator' } }
			)
			expect(names(built.fields)).toEqual(['title', 'author'])
		})

		it('do not switch on a field that is off', () => {
			const built = buildAuditConfig(existing, { auditLog: true }, 'users', {
				createdBy: { name: 'creator' },
			})
			expect(names(built.fields)).toEqual(['title'])
		})
	})
})
