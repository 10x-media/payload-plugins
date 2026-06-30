import type { Endpoint } from 'payload'
import queryString from 'query-string'
import { createIvrStore } from '../utils/ivrStore'
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
}

const createSipgateIvrHandler =
	({ flowsSlug, ivrEndpointUrl }: CreateSipgateIvrOptions): Endpoint['handler'] =>
	async (req) => {
		if (!req.text) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const body = await req.text()
		const data = queryString.parse(body) as unknown as IvrDtmfPayload

		if (!data.callId) {
			return Response.json({ error: 'Missing callId' }, { status: 400 })
		}

		const store = createIvrStore(req.payload, data.callId)
		const session = await store.get()

		if (!session) {
			return xmlResponse({ action: { type: 'hangup' } })
		}

		const flowResult = await req.payload.findByID({
			collection: flowsSlug as 'ivr-flows',
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

export const createSipgateIvr = (options: CreateSipgateIvrOptions): Endpoint => ({
	path: '/sipgate/ivr',
	method: 'post',
	handler: createSipgateIvrHandler(options),
})
