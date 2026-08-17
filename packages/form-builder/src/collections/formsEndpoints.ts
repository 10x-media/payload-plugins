import type { CollectionConfig, PayloadRequest } from 'payload'
import {
	type FromAddressesResolver,
	type FromAddressSourceRegistry,
	resolveFromAddressesRequest,
} from '../actions/fromAddresses'
import {
	type FormResultsAccess,
	resolveFormResultsRequest,
} from '../aggregation/resolveResultsRequest'
import { resolveConsentSourcesRequest } from '../consent/resolveConsentSourcesRequest'
import type { ConsentSourcesResolver } from '../consent/types'
import { type DepartmentEmailsResolver, resolveDepartmentsRequest } from '../email/departments'
import { resolvePollCloseRequest } from '../poll/resolvePollCloseRequest'
import { resolvePollOptionsRequest } from '../poll/resolvePollOptionsRequest'

type FormsEndpointDeps = {
	/** Host seam gating anonymous results reads (plugin option `results.access`). */
	resultsAccess?: FormResultsAccess
	/** The poll-eligible field-type names; the `/:id/results` endpoint restricts reads to these. */
	pollResultsTypes: string[]
	/** Whether the hidden tally store backs poll reads and the close endpoint's outcome aggregation. */
	pollVotesEnabled: boolean
	/** The plugin `consent.sources` option; present registers the `/:id/consent-sources` endpoint. */
	consentSources?: ConsentSourcesResolver
	/** The plugin `email.fromAddresses` option; this or `fromSources` present registers the `/:id/from-addresses` endpoint. */
	fromAddresses?: FromAddressesResolver
	/** The plugin `email.fromSources` option; served ahead of the resolver's literals. */
	fromSources?: FromAddressSourceRegistry
	/** The plugin `email.departments` option; present registers the `/:id/departments` endpoint. */
	departments?: DepartmentEmailsResolver
}

/**
 * The forms collection's built-in endpoints: poll results/options/close, plus the optional
 * consent-sources, from-addresses, and departments option endpoints that only exist when the
 * matching plugin option is set. Each delegates to its request helper, which owns the auth check
 * (anonymous callers get a 403 from the helper, not here). Extracted from `buildFormsCollection`
 * so the collection builder stays focused on field and hook composition.
 */
export const buildFormsEndpoints = ({
	resultsAccess,
	pollResultsTypes,
	pollVotesEnabled,
	consentSources,
	fromAddresses,
	fromSources,
	departments,
}: FormsEndpointDeps): Exclude<CollectionConfig['endpoints'], false | undefined> => [
	{
		path: '/:id/results',
		method: 'get',
		handler: async (req: PayloadRequest) => {
			const field = typeof req.query?.field === 'string' ? req.query.field : undefined
			const { status, body } = await resolveFormResultsRequest({
				payload: req.payload,
				formId: req.routeParams?.id as number | string | undefined,
				field,
				isAuthed: Boolean(req.user),
				req,
				access: resultsAccess,
				eligibleTypes: pollResultsTypes,
				pollVotesEnabled,
			})
			return Response.json(body, { status })
		},
	},
	{
		path: '/:id/poll-options',
		method: 'get',
		handler: async (req: PayloadRequest) => {
			const { status, body } = await resolvePollOptionsRequest({
				payload: req.payload,
				formId: req.routeParams?.id as number | string | undefined,
				isAuthed: Boolean(req.user),
				req,
			})
			return Response.json(body, { status })
		},
	},
	// Trusted admin action (authenticated only): close a poll now and resolve its outcome. A POST
	// because it mutates; auth is `Boolean(req.user)` so an anonymous caller gets 403 from the helper.
	{
		path: '/:id/close',
		method: 'post',
		handler: async (req: PayloadRequest) => {
			const { status, body } = await resolvePollCloseRequest({
				payload: req.payload,
				formId: req.routeParams?.id as number | string | undefined,
				isAuthed: Boolean(req.user),
				pollVotesEnabled,
				req,
			})
			return Response.json(body, { status })
		},
	},
	...(consentSources
		? [
				{
					path: '/:id/consent-sources',
					method: 'get' as const,
					handler: async (req: PayloadRequest) => {
						const { status, body } = await resolveConsentSourcesRequest({
							payload: req.payload,
							formId: req.routeParams?.id as number | string | undefined,
							isAuthed: Boolean(req.user),
							req,
							resolver: consentSources,
						})
						return Response.json(body, { status })
					},
				},
			]
		: []),
	// The route id is unused: the from-addresses set is request-scoped (e.g. per tenant), not
	// per-form. Registered as a doc-scoped route only so the admin field can reuse
	// EndpointOptionsSelect unmodified (see buildFromField).
	...(fromAddresses || fromSources
		? [
				{
					path: '/:id/from-addresses',
					method: 'get' as const,
					handler: async (req: PayloadRequest) => {
						const { status, body } = await resolveFromAddressesRequest({
							isAuthed: Boolean(req.user),
							req,
							resolver: fromAddresses,
							sources: fromSources,
						})
						return Response.json(body, { status })
					},
				},
			]
		: []),
	// Same request-scoped, id-unused shape as from-addresses: registered doc-scoped only so the
	// recipient selects can fetch it (see RecipientsSelect / buildRecipientField).
	...(departments
		? [
				{
					path: '/:id/departments',
					method: 'get' as const,
					handler: async (req: PayloadRequest) => {
						const { status, body } = await resolveDepartmentsRequest({
							isAuthed: Boolean(req.user),
							req,
							resolver: departments,
						})
						return Response.json(body, { status })
					},
				},
			]
		: []),
]
