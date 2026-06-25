const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

type DialTarget = { type: 'number'; value: string } | { type: 'voicemail' }

export type DialOptions = {
	callerId?: string
	anonymous?: boolean
	targets: DialTarget[]
}

export type PlayOptions = {
	url: string
}

export type GatherOptions = {
	onData: string
	maxDigits?: number
	/** Timeout in milliseconds */
	timeout?: number
	play?: PlayOptions
}

export type RejectOptions = {
	reason?: 'rejected' | 'busy'
}

export type SipgateAction =
	| { type: 'dial'; options: DialOptions }
	| { type: 'play'; options: PlayOptions }
	| { type: 'gather'; options: GatherOptions }
	| { type: 'reject'; options?: RejectOptions }
	| { type: 'hangup' }

export type SipgateResponseOptions = {
	onAnswer?: string
	onHangup?: string
	action?: SipgateAction
}

function buildAction(action: SipgateAction): string {
	switch (action.type) {
		case 'dial': {
			const attrs = [
				action.options.callerId ? `callerId="${action.options.callerId}"` : '',
				action.options.anonymous != null ? `anonymous="${action.options.anonymous}"` : '',
			]
				.filter(Boolean)
				.join(' ')
			const targets = action.options.targets
				.map((t) => (t.type === 'voicemail' ? '<Voicemail />' : `<Number>${t.value}</Number>`))
				.join('')
			return `<Dial${attrs ? ` ${attrs}` : ''}>${targets}</Dial>`
		}
		case 'play':
			return `<Play><Url>${action.options.url}</Url></Play>`
		case 'gather': {
			const attrs = [
				`onData="${action.options.onData}"`,
				action.options.maxDigits != null ? `maxDigits="${action.options.maxDigits}"` : '',
				action.options.timeout != null ? `timeout="${action.options.timeout}"` : '',
			]
				.filter(Boolean)
				.join(' ')
			const inner = action.options.play ? `<Play><Url>${action.options.play.url}</Url></Play>` : ''
			return `<Gather ${attrs}>${inner}</Gather>`
		}
		case 'reject': {
			const reason = action.options?.reason
			return reason ? `<Reject reason="${reason}" />` : '<Reject />'
		}
		case 'hangup':
			return '<Hangup />'
	}
}

export function buildXmlResponse(options: SipgateResponseOptions = {}): string {
	const attrs = [
		options.onAnswer ? `onAnswer="${options.onAnswer}"` : '',
		options.onHangup ? `onHangup="${options.onHangup}"` : '',
	]
		.filter(Boolean)
		.join(' ')

	const action = options.action ? buildAction(options.action) : ''

	if (!attrs && !action) {
		return `${XML_HEADER}\n<Response />`
	}

	if (!action) {
		return `${XML_HEADER}\n<Response ${attrs} />`
	}

	return `${XML_HEADER}\n<Response${attrs ? ` ${attrs}` : ''}>${action}</Response>`
}

export function xmlResponse(options: SipgateResponseOptions = {}): Response {
	return new Response(buildXmlResponse(options), {
		status: 200,
		headers: { 'Content-Type': 'application/xml' },
	})
}
