import type { PayloadRequest } from 'payload'
import type { GatedScope } from '../access/principal'
import type { BindingDoc, DocumentScopeField } from '../binding/types'
import { resolveRequestedScope } from '../core/scopedRead'
import { scopeFromDocument } from '../fields/documentScope'
import { type AnalyticsRuntime, type ScopeGates, scopeGates } from './runtime'

/**
 * Field a collection's documents carry their scope in: the binding's server-side `scopeField`, so
 * no request can choose which field a scope is read out of.
 */
export const scopeFieldFor = (runtime: AnalyticsRuntime, collection: string): DocumentScopeField =>
	runtime.bindings[collection]?.scopeField ?? false

/**
 * A document's own scope, or a refusal to read across into it. `gated` is that scope cleared
 * for the request, absent when the document names none and the read stays on the request's own.
 */
export type DocumentScope =
	| { ok: true; scope: null }
	| { ok: true; scope: string; gated: GatedScope }
	| { ok: false }

interface DocumentScopeArgs {
	runtime: AnalyticsRuntime
	req: PayloadRequest
	collection: string
	data: BindingDoc
	/** Shared cross-scope decisions; one set is created per call when omitted. */
	gates?: ScopeGates
}

/**
 * A document's scope, gated via {@link resolveRequestedScope} like a named `scope` parameter.
 * Payload read access is a separate first gate: a readable foreign row still reports nothing.
 */
export const resolveDocumentScope = async (args: DocumentScopeArgs): Promise<DocumentScope> => {
	const { runtime, req } = args
	const scope = scopeFromDocument(args.data, scopeFieldFor(runtime, args.collection))
	if (scope === null) {
		return { ok: true, scope: null }
	}
	const requested = await resolveRequestedScope({
		runtime,
		req,
		raw: scope,
		gates: args.gates ?? scopeGates(runtime, req),
	})
	if (!requested.ok || requested.scope === null) {
		return { ok: false }
	}
	return { ok: true, scope: requested.scope, gated: requested.gated }
}
