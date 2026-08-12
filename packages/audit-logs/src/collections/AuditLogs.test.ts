import type { CollectionSlug, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { buildAuditLogsCollection } from './AuditLogs'

const names = (fields: Field[]): string[] =>
	fields.flatMap((field) => ('name' in field && field.name ? [field.name] : []))

const field = (fields: Field[], name: string): Field | undefined =>
	fields.find((f) => 'name' in f && f.name === name)

describe('buildAuditLogsCollection', () => {
	it('is addressed by a fixed slug', () => {
		expect(buildAuditLogsCollection().slug).toBe('audit-logs')
	})

	it('denies every operation by default, the plugin writes with overrideAccess', () => {
		const access = buildAuditLogsCollection().access ?? {}
		const args = {} as Parameters<NonNullable<typeof access.read>>[0]
		expect(access.create?.(args)).toBe(false)
		expect(access.delete?.(args)).toBe(false)
		expect(access.read?.(args)).toBe(false)
		expect(access.update?.(args)).toBe(false)
	})

	it('takes the access rules it was given', () => {
		const allow = () => true
		const access = buildAuditLogsCollection(true, 'users', { read: allow }).access ?? {}
		const args = {} as Parameters<NonNullable<typeof access.read>>[0]
		expect(access.read).toBe(allow)
		expect(access.create?.(args)).toBe(false)
	})

	it('is hidden from the sidebar unless asked otherwise', () => {
		expect(buildAuditLogsCollection().admin?.hidden).toBe(true)
		expect(buildAuditLogsCollection(false).admin?.hidden).toBe(false)
	})

	it('carries the fields every entry is written with', () => {
		const collection = buildAuditLogsCollection()
		expect(names(collection.fields)).toEqual(
			expect.arrayContaining([
				'operation',
				'eventType',
				'relationTo',
				'documentId',
				'user',
				'changedPaths',
				'diff',
				'snapshot',
			])
		)
	})

	it('points the user field wherever the host authenticates', () => {
		const single = field(buildAuditLogsCollection(true, 'admins').fields, 'user')
		expect(single && 'relationTo' in single && single.relationTo).toBe('admins')

		const many = field(
			buildAuditLogsCollection(true, ['users', 'admins'] as CollectionSlug[]).fields,
			'user'
		)
		expect(many && 'relationTo' in many && many.relationTo).toEqual(['users', 'admins'])
	})

	describe('optional fields', () => {
		it('adds a tenant field only with multi-tenancy on', () => {
			expect(names(buildAuditLogsCollection().fields)).not.toContain('tenant')
			expect(names(buildAuditLogsCollection(true, 'users', undefined, 'tenants').fields)).toContain(
				'tenant'
			)
		})

		it('adds an archive marker only when archiving is on', () => {
			expect(names(buildAuditLogsCollection().fields)).not.toContain('archivedAt')
			expect(
				names(buildAuditLogsCollection(true, 'users', undefined, undefined, true).fields)
			).toContain('archivedAt')
		})

		it('adds a group field only when grouping is on', () => {
			expect(names(buildAuditLogsCollection().fields)).not.toContain('group')
			expect(
				names(buildAuditLogsCollection(true, 'users', undefined, undefined, false, true).fields)
			).toContain('group')
		})
	})

	describe('indexes', () => {
		it('pairs each filter the view offers with the sort it always applies', () => {
			expect(buildAuditLogsCollection().indexes).toEqual([
				{ fields: ['relationTo', 'documentId', 'createdAt'] },
				{ fields: ['user', 'createdAt'] },
			])
		})

		it('adds the tenant pair only when there are tenants to filter by', () => {
			expect(buildAuditLogsCollection(true, 'users', undefined, 'tenants').indexes).toContainEqual({
				fields: ['tenant', 'createdAt'],
			})
		})
	})
})
