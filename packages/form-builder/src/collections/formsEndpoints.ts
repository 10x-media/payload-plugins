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
/** A request-scoped GET route at its id-less path plus the legacy doc-scoped path, one handler. */
const requestScopedRoutes = (
	name: string,
	handler: (req: PayloadRequest) => Promise<Response>
): Exclude<CollectionConfig['endpoints'], false | undefined> => [
	{ path: `/${name}`, method: 'get', handler },
	{ path: `/:id/${name}`, method: 'get', handler },
]

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
	// The from-addresses and departments sets are request-scoped (e.g. per tenant), never per-form.
	// Each lives at the id-less path the selects call (which is what lets their options load while
	// a form is still being created), with the legacy `/:id/` route kept on the same handler for
	// integrators that hardcoded it.
	...(fromAddresses || fromSources
		? requestScopedRoutes('from-addresses', async (req: PayloadRequest) => {
				const { status, body } = await resolveFromAddressesRequest({
					isAuthed: Boolean(req.user),
					req,
					resolver: fromAddresses,
					sources: fromSources,
				})
				return Response.json(body, { status })
			})
		: []),
	...(departments
		? requestScopedRoutes('departments', async (req: PayloadRequest) => {
				const { status, body } = await resolveDepartmentsRequest({
					isAuthed: Boolean(req.user),
					req,
					resolver: departments,
				})
				return Response.json(body, { status })
			})
		: []),
]
