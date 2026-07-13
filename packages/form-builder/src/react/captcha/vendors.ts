export type TurnstileRenderParams = {
	sitekey: string
	callback?: (token: string) => void
	'expired-callback'?: () => void
	'error-callback'?: () => void
	[key: string]: unknown
}

export type TurnstileApi = {
	render(container: HTMLElement, params: TurnstileRenderParams): string
	reset(widgetId: string): void
	remove(widgetId: string): void
}

export type RecaptchaRenderParams = {
	sitekey: string
	callback?: (token: string) => void
	'expired-callback'?: () => void
	'error-callback'?: () => void
	[key: string]: unknown
}

export type GrecaptchaApi = {
	ready(cb: () => void): void
	render(container: HTMLElement, params: RecaptchaRenderParams): number
	reset(widgetId?: number): void
	execute(siteKey: string, options?: { action?: string }): Promise<string>
}

export type HcaptchaRenderParams = {
	sitekey: string
	callback?: (token: string) => void
	'expired-callback'?: () => void
	'error-callback'?: () => void
	[key: string]: unknown
}

export type HcaptchaApi = {
	render(container: HTMLElement, params: HcaptchaRenderParams): string
	reset(widgetId?: string): void
	remove(widgetId?: string): void
}

export const getTurnstile = (): TurnstileApi | undefined =>
	(globalThis as { turnstile?: TurnstileApi }).turnstile

export const getGrecaptcha = (): GrecaptchaApi | undefined =>
	(globalThis as { grecaptcha?: GrecaptchaApi }).grecaptcha

export const getHcaptcha = (): HcaptchaApi | undefined =>
	(globalThis as { hcaptcha?: HcaptchaApi }).hcaptcha
