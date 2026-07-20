import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FromAddressOption } from '../../src/actions/fromAddresses'
import { formBuilder } from '../../src/index'

const tenantOptions: Record<string, FromAddressOption[]> = {
	acme: [{ label: 'Acme support', value: 'support@acme.example.com' }],
	globex: [{ label: 'Globex support', value: 'support@globex.example.com' }],
}

// Simulates a host's tenant-scoped resolver: real multi-tenant hosts derive the tenant from
// `req` (auth context, host header, or cookie); this reads it off `req.user.tenant` instead,
// which is enough to prove the resolver receives the real per-request `req`.
const fromAddresses = ({ req }: { req: PayloadRequest }): FromAddressOption[] => {
	const tenant = (req.user as { tenant?: string } | undefined)?.tenant ?? ''
	return tenantOptions[tenant] ?? []
}

describeForDb('form-builder email.fromAddresses', { dbs: ['mongo'] }, (db) => {
	describe('with the option set', () => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({ plugin: formBuilder({ email: { fromAddresses } }), db })
		})

		afterAll(async () => {
			await booted.stop()
		})

		const makeForm = async (from: string) =>
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Tenant form',
					fields: [{ blockType: 'email', name: 'email', label: 'Email' }],
					actions: [
						{ blockType: 'emailTeam', to: 'team@x.com', from, subject: 'Hi', body: '' },
						{ blockType: 'confirmation', toField: 'email', from, subject: 'Hi', body: '' },
					],
				},
				req: { user: { id: 1, collection: 'users', tenant: 'acme' } } as never,
			})

		const fromAddressesEndpoint = () => {
			const endpoints = booted.payload.collections.forms?.config.endpoints as
				| Array<{ path: string; handler: (req: PayloadRequest) => Promise<Response> }>
				| undefined
			return endpoints?.find((endpoint) => endpoint.path === '/:id/from-addresses')
		}

		it('registers the from-addresses endpoint on the forms collection', () => {
			expect(fromAddressesEndpoint()).toBeDefined()
		})

		it('returns 403 for an anonymous request to the endpoint', async () => {
			const response = await fromAddressesEndpoint()?.handler({
				user: undefined,
			} as unknown as PayloadRequest)
			expect(response?.status).toBe(403)
		})

		it('serves tenant-scoped options through the endpoint, keyed off the real request', async () => {
			const acme = await fromAddressesEndpoint()?.handler({
				user: { id: 1, collection: 'users', tenant: 'acme' },
			} as unknown as PayloadRequest)
			expect(acme?.status).toBe(200)
			expect(await acme?.json()).toEqual({ options: tenantOptions.acme })

			const globex = await fromAddressesEndpoint()?.handler({
				user: { id: 1, collection: 'users', tenant: 'globex' },
			} as unknown as PayloadRequest)
			expect(await globex?.json()).toEqual({ options: tenantOptions.globex })
		})

		it('accepts a from address the resolver returns for the acting admin', async () => {
			const form = await makeForm('support@acme.example.com')
			const actions = form.actions as Array<Record<string, unknown>>
			expect(actions[0]?.from).toBe('support@acme.example.com')
			expect(actions[1]?.from).toBe('support@acme.example.com')
		})

		it('accepts an unset from address', async () => {
			const form = await booted.payload.create({
				collection: 'forms',
				data: {
					title: 'No from',
					fields: [],
					actions: [{ blockType: 'emailTeam', to: 'team@x.com', subject: 'Hi', body: '' }],
				},
				req: { user: { id: 1, collection: 'users', tenant: 'acme' } } as never,
			})
			const actions = form.actions as Array<Record<string, unknown>>
			expect(actions[0]?.from ?? '').toBe('')
		})

		it('rejects a from address outside the resolved set for the acting admin', async () => {
			await expect(makeForm('support@globex.example.com')).rejects.toThrow()
		})

		it('rejects a from address when the resolver denies the acting admin entirely', async () => {
			await expect(
				booted.payload.create({
					collection: 'forms',
					data: {
						title: 'Untenanted admin',
						fields: [],
						actions: [
							{
								blockType: 'emailTeam',
								to: 'team@x.com',
								from: 'support@acme.example.com',
								subject: 'Hi',
								body: '',
							},
						],
					},
					req: { user: { id: 1, collection: 'users' } } as never,
				})
			).rejects.toThrow()
		})
	})

	describe('with the option absent', () => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({ plugin: formBuilder({}), db })
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('omits the from field from the sanitized emailTeam and confirmation blocks', () => {
			const formsCollection = booted.payload.collections.forms
			const tabsField = formsCollection?.config.fields.find((field) => field.type === 'tabs') as
				| { tabs: Array<{ fields: Array<{ name?: string; type?: string }> }> }
				| undefined
			const tabFields = tabsField?.tabs.flatMap((tab) => tab.fields) ?? []
			const actionsField = tabFields.find((field) => field.name === 'actions') as
				| { blocks?: Array<{ slug: string; fields: Array<{ name?: string }> }> }
				| undefined
			const emailTeamBlock = actionsField?.blocks?.find((b) => b.slug === 'emailTeam')
			const confirmationBlock = actionsField?.blocks?.find((b) => b.slug === 'confirmation')
			expect(emailTeamBlock?.fields.some((f) => f.name === 'from')).toBe(false)
			expect(confirmationBlock?.fields.some((f) => f.name === 'from')).toBe(false)
		})

		it('registers no from-addresses endpoint', () => {
			const endpoints = booted.payload.collections.forms?.config.endpoints
			expect(
				Array.isArray(endpoints) &&
					endpoints.some((endpoint) => endpoint.path === '/:id/from-addresses')
			).toBe(false)
		})

		it('still accepts an emailTeam action (a bare "from" key is simply an unrecognized extra, ignored by the block schema)', async () => {
			const form = await booted.payload.create({
				collection: 'forms',
				data: {
					title: 'No email option',
					fields: [],
					actions: [{ blockType: 'emailTeam', to: 'team@x.com', subject: 'Hi', body: '' }],
				},
			})
			expect(form.id).toBeDefined()
		})
	})
})
