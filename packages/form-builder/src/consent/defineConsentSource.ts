import type { Field, Payload, PayloadRequest } from 'payload'

export type ConsentLink = { label: string; url: string }
export type ConsentResolved = { links: ConsentLink[]; versionRef?: string; versionLabel?: string }

export type ConsentResolveArgs<TConfig extends Record<string, unknown> = Record<string, unknown>> =
	{
		config: TConfig
		payload: Payload
		req?: PayloadRequest
		locale: string
	}

/**
 * A consent source type, authored once: `config` is the admin `Field[]` for authoring;
 * `resolve` returns localized policy links and an optional version reference at capture time.
 * Built-ins use this same primitive.
 */
export type ConsentSource<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	type: string
	label: string
	config?: Field[]
	resolve: (args: ConsentResolveArgs<TConfig>) => Promise<ConsentResolved> | ConsentResolved
}

/** Erased shape stored in the registry; config re-narrows per matched type at resolution. */
export type AnyConsentSource = ConsentSource<Record<string, unknown>>

export const defineConsentSource = <
	TConfig extends Record<string, unknown> = Record<string, unknown>,
>(
	source: ConsentSource<TConfig>
): ConsentSource<TConfig> => source
