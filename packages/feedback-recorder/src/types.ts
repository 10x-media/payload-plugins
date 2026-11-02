import type { Payload, TypedUser } from 'payload'

import type { TranslationsOption } from './translations'

/** Who may see the recorder and use its endpoints. Called with the signed-in user. */
export type RecorderAccess = (args: {
	payload: Payload
	user: TypedUser
}) => boolean | Promise<boolean>

export type FeedbackRecorderEnabledOptions = {
	/**
	 * Base URL of the 10x Media system, e.g. `https://system.10xmedia.de`. Usually
	 * `process.env.TENX_RECORDINGS_URL`. Without it (or without `apiKey`) the recorder stays hidden.
	 */
	url?: string
	/**
	 * The recording key minted for this site in the 10x system (`rec_...`). Server-side only: it
	 * never reaches the browser. Usually `process.env.TENX_RECORDINGS_KEY`.
	 */
	apiKey?: string
	/**
	 * Who may record. Defaults to any user of the admin's own auth collection
	 * (`admin.user`), so customer accounts in other auth collections never see it.
	 */
	access?: RecorderAccess
	/** Shown with each recording so the team knows which release it was made on, e.g. a commit SHA. */
	appVersion?: string
	/**
	 * Also send the browser console's errors and warnings from the recording, at most 50.
	 * Off by default: console output can contain personal data.
	 */
	captureConsole?: boolean
	/** Where the plugin's endpoints live under the API route. Defaults to `/feedback-recorder`. */
	apiPath?: string
	/** Show the record button in the admin header. Defaults to true. */
	headerAction?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed translation keys
	 * exported from `@10x-media/feedback-recorder/i18n`.
	 */
	translations?: TranslationsOption
}

export type FeedbackRecorderPluginOptions =
	| ({ disabled: true } & Partial<FeedbackRecorderEnabledOptions>)
	| ({ disabled?: false } & FeedbackRecorderEnabledOptions)

export type ResolvedOptions = {
	url: string | null
	apiKey: string | null
	configured: boolean
	access: RecorderAccess
	appVersion: string | null
	captureConsole: boolean
	apiPath: string
	headerAction: boolean
}

/** What the admin's client components need, passed down from the server action. */
export type ClientConfig = {
	endpoint: string
	adminRoute: string
	captureConsole: boolean
}
