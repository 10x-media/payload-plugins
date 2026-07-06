import type { CollectionSlug, Payload } from 'payload'
import type { SipgateAction } from './xmlFactory'

export type IvrBranch = {
	dtmf: string
	nextStepId: string
}

export type IvrStep = {
	stepId: string
	type: 'play' | 'gather'
	voiceLine: string | { url?: string | null }
	hangupAfterPlay?: boolean | null
	maxDigits?: number | null
	timeout?: number | null
	branches?: IvrBranch[] | null
	fallbackStepId?: string | null
}

export type IvrFlow = {
	id: string
	name: string
	phoneNumber?: string | null
	isActive: boolean
	entryStepId: string
	steps: IvrStep[]
}

export const findFlowForNumber = async (
	payload: Payload,
	flowsSlug: string,
	toNumber: string
): Promise<IvrFlow | null> => {
	const result = await payload.find({
		collection: flowsSlug as CollectionSlug,
		where: {
			and: [{ isActive: { equals: true } }, { phoneNumber: { equals: toNumber } }],
		},
		limit: 1,
		depth: 1,
	})

	if (result.docs.length > 0) {
		return result.docs[0] as unknown as IvrFlow
	}

	// Fall back to catch-all flows (no phoneNumber set)
	const catchAll = await payload.find({
		collection: flowsSlug as CollectionSlug,
		where: {
			and: [{ isActive: { equals: true } }, { phoneNumber: { exists: false } }],
		},
		limit: 1,
		depth: 1,
	})

	return catchAll.docs.length > 0 ? (catchAll.docs[0] as unknown as IvrFlow) : null
}

export const resolveVoiceLineUrl = (step: IvrStep): string | null => {
	const vl = step.voiceLine
	if (!vl || typeof vl === 'string') return null
	return vl.url ?? null
}

export const buildStepAction = (
	step: IvrStep,
	voiceLineUrl: string,
	onDataUrl: string
): SipgateAction => {
	if (step.type === 'play') {
		return { type: 'play', options: { url: voiceLineUrl } }
	}

	return {
		type: 'gather',
		options: {
			onData: onDataUrl,
			maxDigits: step.maxDigits ?? 1,
			timeout: step.timeout ?? 5000,
			play: { url: voiceLineUrl },
		},
	}
}

export const resolveNextStepId = (step: IvrStep, dtmf: string): string | null => {
	const branch = step.branches?.find((b) => b.dtmf === dtmf)
	if (branch) return branch.nextStepId
	return step.fallbackStepId ?? null
}
