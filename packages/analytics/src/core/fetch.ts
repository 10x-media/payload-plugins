/** What the plugin's server code hands a fetch; the global `fetch` accepts all of it. */
export interface FetchInit {
	method?: string
	headers?: HeadersInit
	body?: string | ArrayBuffer | null
	signal?: AbortSignal | null
	redirect?: RequestRedirect
}

/**
 * A fetch the plugin reaches a vendor with: the global one, or the guarded one adapters built from
 * provider documents use.
 */
export type FetchLike = (input: string | URL, init?: FetchInit) => Promise<Response>
