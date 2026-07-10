const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

/** Escapes characters that are special in XML text content and attribute values. */
function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

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
				action.options.callerId ? `callerId="${escapeXml(action.options.callerId)}"` : '',
				action.options.anonymous != null ? `anonymous="${action.options.anonymous}"` : '',
			]
				.filter(Boolean)
				.join(' ')
			const targets = action.options.targets
				.map((t) =>
					t.type === 'voicemail' ? '<Voicemail />' : `<Number>${escapeXml(t.value)}</Number>`
				)
				.join('')
			return `<Dial${attrs ? ` ${attrs}` : ''}>${targets}</Dial>`
		}
		case 'play':
			return `<Play><Url>${escapeXml(action.options.url)}</Url></Play>`
		case 'gather': {
			const attrs = [
				`onData="${escapeXml(action.options.onData)}"`,
				action.options.maxDigits != null ? `maxDigits="${action.options.maxDigits}"` : '',
				action.options.timeout != null ? `timeout="${action.options.timeout}"` : '',
			]
				.filter(Boolean)
				.join(' ')
			const inner = action.options.play
				? `<Play><Url>${escapeXml(action.options.play.url)}</Url></Play>`
				: ''
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

/** Builds the XML string for a sipgate webhook response. All interpolated values are XML-escaped. */
export function buildXmlResponse(options: SipgateResponseOptions = {}): string {
	const attrs = [
		options.onAnswer ? `onAnswer="${escapeXml(options.onAnswer)}"` : '',
		options.onHangup ? `onHangup="${escapeXml(options.onHangup)}"` : '',
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

/** Returns an HTTP 200 response with the sipgate XML body and the correct Content-Type header. */
export function xmlResponse(options: SipgateResponseOptions = {}): Response {
	return new Response(buildXmlResponse(options), {
		status: 200,
		headers: { 'Content-Type': 'application/xml' },
	})
}
