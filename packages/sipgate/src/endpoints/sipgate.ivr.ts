import { type CollectionSlug, deepMerge, type Endpoint } from 'payload'
import { createIvrStore } from '../utils/ivrStore'
import { parseFormBody } from '../utils/parseFormBody'
import { buildStepAction, resolveNextStepId, resolveVoiceLineUrl } from '../utils/sipgateIvrHandler'
import { xmlResponse } from '../utils/xmlFactory'

type IvrDtmfPayload = {
	callId: string
	dtmf: string
}

type CreateSipgateIvrOptions = {
	flowsSlug: string
	voiceLinesSlug: string
	ivrEndpointUrl: string
	overrides?: Partial<Endpoint>
}

const createSipgateIvrHandler =
	({ flowsSlug, ivrEndpointUrl }: CreateSipgateIvrOptions): Endpoint['handler'] =>
	async (req) => {
		if (!req.text) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const body = await req.text()
		const data = parseFormBody(body) as unknown as IvrDtmfPayload

		if (!data.callId) {
			return Response.json({ error: 'Missing callId' }, { status: 400 })
		}

		const store = createIvrStore(req.payload, data.callId)
		const session = await store.get()

		if (!session) {
			return xmlResponse({ action: { type: 'hangup' } })
		}

		const flowResult = await req.payload.findByID({
			collection: flowsSlug as CollectionSlug,
			id: session.flowId,
			depth: 1,
		})

		const flow = flowResult as unknown as import('../utils/sipgateIvrHandler').IvrFlow | null

		if (!flow) {
			await store.clear()
			return xmlResponse({ action: { type: 'hangup' } })
		}

		const currentStep = flow.steps.find((s) => s.stepId === session.stepId)

		if (!currentStep) {
			await store.clear()
			return xmlResponse({ action: { type: 'hangup' } })
		}

		const nextStepId = resolveNextStepId(currentStep, data.dtmf ?? '')

		if (!nextStepId) {
			await store.clear()
			return xmlResponse({ action: { type: 'hangup' } })
		}

		const nextStep = flow.steps.find((s) => s.stepId === nextStepId)

		if (!nextStep) {
			await store.clear()
			return xmlResponse({ action: { type: 'hangup' } })
		}

		const voiceLineUrl = resolveVoiceLineUrl(nextStep)

		if (!voiceLineUrl) {
			await store.clear()
			return xmlResponse({ action: { type: 'hangup' } })
		}

		await store.update({ stepId: nextStepId })

		return xmlResponse({ action: buildStepAction(nextStep, voiceLineUrl, ivrEndpointUrl) })
	}

export const createSipgateIvr = ({
	flowsSlug,
	voiceLinesSlug,
	ivrEndpointUrl,
	overrides,
}: CreateSipgateIvrOptions): Endpoint => {
	const defaultEndpoint: Endpoint = {
		path: '/sipgate/ivr',
		method: 'post',
		handler: createSipgateIvrHandler({ flowsSlug, voiceLinesSlug, ivrEndpointUrl }),
	}
	return deepMerge<Endpoint>(defaultEndpoint, overrides ?? {})
}
