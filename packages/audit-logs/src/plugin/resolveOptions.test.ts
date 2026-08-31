import { describe, expect, it } from 'vitest'

import {
	DEFAULT_AUDIT_LOG_OPERATIONS,
	isPolymorphicRelationTo,
	mergeWithDefaults,
	payloadAPILabels,
	resolveAuditLogConfig,
	resolveAuthConfig,
	resolveFieldOptions,
	resolveGlobalAuditLogConfig,
	resolveHookPath,
	resolvePayloadAPIOptions,
} from './resolveOptions'

describe('isPolymorphicRelationTo', () => {
	it('needs two or more collections', () => {
		expect(isPolymorphicRelationTo('users')).toBe(false)
		expect(isPolymorphicRelationTo(['users'])).toBe(false)
		expect(isPolymorphicRelationTo(['users', 'admins'])).toBe(true)
	})
})

describe('resolveFieldOptions', () => {
	it('true enables both fields with no overrides', () => {
		expect(resolveFieldOptions(true, 'createdBy')).toEqual({})
		expect(resolveFieldOptions(true, 'lastModifiedBy')).toEqual({})
	})

	it('is off unless auditFields is set', () => {
		expect(resolveFieldOptions({}, 'createdBy')).toBe(false)
		expect(resolveFieldOptions({ auditLog: true }, 'createdBy')).toBe(false)
	})

	it('auditFields: true enables both', () => {
		expect(resolveFieldOptions({ auditFields: true }, 'createdBy')).toEqual({})
		expect(resolveFieldOptions({ auditFields: true }, 'lastModifiedBy')).toEqual({})
	})

	it('picks one field without enabling the other', () => {
		const options = { auditFields: { createdBy: { name: 'author' } } } as const
		expect(resolveFieldOptions(options, 'createdBy')).toEqual({ name: 'author' })
		expect(resolveFieldOptions(options, 'lastModifiedBy')).toBe(false)
	})
})

describe('resolveHookPath', () => {
	it('manual fields declare their own path', () => {
		expect(resolveHookPath({ isManual: true, path: 'meta.author' }, 'createdBy')).toBe(
			'meta.author'
		)
	})

	it('automatic fields fall back to the default name', () => {
		expect(resolveHookPath({}, 'createdBy')).toBe('createdBy')
		expect(resolveHookPath({ name: 'author' }, 'createdBy')).toBe('author')
	})
})

describe('mergeWithDefaults', () => {
	it('per-entity options win over plugin defaults', () => {
		expect(
			mergeWithDefaults({ name: 'author' }, { name: 'creator', disableCustomComponent: true })
		).toEqual({ name: 'author', disableCustomComponent: true })
	})

	it('leaves disabled and manual options alone', () => {
		expect(mergeWithDefaults(false, { name: 'creator' })).toBe(false)
		const manual = { isManual: true, path: 'meta.author' } as const
		expect(mergeWithDefaults(manual, { name: 'creator' })).toBe(manual)
	})

	it('passes options through when there are no defaults', () => {
		const options = { name: 'author' }
		expect(mergeWithDefaults(options, undefined)).toBe(options)
	})
})

describe('resolveAuditLogConfig', () => {
	it('true logs all three operations without snapshots', () => {
		expect(resolveAuditLogConfig(true)).toEqual({
			operations: DEFAULT_AUDIT_LOG_OPERATIONS,
			snapshotOnCreate: false,
			snapshotOnDelete: false,
		})
	})

	it('is off unless auditLog is set', () => {
		expect(resolveAuditLogConfig({})).toBe(false)
		expect(resolveAuditLogConfig({ auditFields: true })).toBe(false)
		expect(resolveAuditLogConfig({ auditLog: false })).toBe(false)
	})

	it('keeps the operations it was given', () => {
		const resolved = resolveAuditLogConfig({ auditLog: { operations: ['delete'] } })
		expect(resolved !== false ? resolved.operations : undefined).toEqual(['delete'])
	})

	it('carries drafts, excludeFields and shouldLog through', () => {
		const shouldLog = () => true
		const resolved = resolveAuditLogConfig({
			auditLog: { drafts: 'log', excludeFields: ['hash'], shouldLog },
		})
		expect(resolved).toMatchObject({
			drafts: 'log',
			excludeFields: ['hash'],
			shouldLog,
			operations: DEFAULT_AUDIT_LOG_OPERATIONS,
		})
	})
})

describe('resolveGlobalAuditLogConfig', () => {
	it('carries no operations, globals only ever update', () => {
		expect(resolveGlobalAuditLogConfig(true)).toEqual({})
		expect(resolveGlobalAuditLogConfig({ auditLog: true })).toEqual({
			drafts: undefined,
			excludeFields: undefined,
			shouldLog: undefined,
		})
	})

	it('is off unless auditLog is set', () => {
		expect(resolveGlobalAuditLogConfig({})).toBe(false)
		expect(resolveGlobalAuditLogConfig({ auditLog: false })).toBe(false)
	})
})

describe('resolveAuthConfig', () => {
	it('an unlisted collection gets no auth events', () => {
		expect(resolveAuthConfig(undefined)).toBe(false)
	})

	it('true enables both events', () => {
		expect(resolveAuthConfig(true)).toEqual({ forgotPassword: true, login: true })
		expect(resolveAuthConfig({ auth: true })).toEqual({ forgotPassword: true, login: true })
	})

	it('is off when the collection is listed without auth', () => {
		expect(resolveAuthConfig({})).toBe(false)
		expect(resolveAuthConfig({ auditLog: true })).toBe(false)
		expect(resolveAuthConfig({ auth: false })).toBe(false)
	})

	it('an object opts out of one event and leaves the other on', () => {
		expect(resolveAuthConfig({ auth: { login: false } })).toEqual({
			forgotPassword: true,
			login: false,
		})
		expect(resolveAuthConfig({ auth: { forgotPassword: false } })).toEqual({
			forgotPassword: false,
			login: true,
		})
	})
})

describe('resolvePayloadAPIOptions', () => {
	it('offers the three APIs core sets on every request', () => {
		expect(resolvePayloadAPIOptions()).toEqual([
			{ label: 'REST', value: 'REST' },
			{ label: 'GraphQL', value: 'GraphQL' },
			{ label: 'Local', value: 'local' },
		])
	})

	it('appends a bare string as its own label', () => {
		expect(resolvePayloadAPIOptions(['MCP'])).toContainEqual({ label: 'MCP', value: 'MCP' })
	})

	it('takes a label alongside the value', () => {
		expect(resolvePayloadAPIOptions([{ label: 'MCP Server', value: 'MCP' }])).toContainEqual({
			label: 'MCP Server',
			value: 'MCP',
		})
	})

	it('lets a host relabel a built-in rather than duplicating it', () => {
		const options = resolvePayloadAPIOptions([{ label: 'Server-side', value: 'local' }])
		expect(options.filter((option) => option.value === 'local')).toEqual([
			{ label: 'Server-side', value: 'local' },
		])
	})

	it('keeps the last of two entries sharing a value', () => {
		expect(resolvePayloadAPIOptions(['MCP', { label: 'MCP Server', value: 'MCP' }])).toContainEqual(
			{
				label: 'MCP Server',
				value: 'MCP',
			}
		)
	})
})

describe('payloadAPILabels', () => {
	it('maps every resolved value to its label', () => {
		expect(payloadAPILabels(['MCP'])).toEqual({
			REST: 'REST',
			GraphQL: 'GraphQL',
			local: 'Local',
			MCP: 'MCP',
		})
	})
})
