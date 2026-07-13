/** Imperative handle exposed by the captcha widget components via their `ref` prop. */
export type CaptchaWidgetHandle = {
	/** Reset the widget, invalidating the current token. */
	reset: () => void
}
