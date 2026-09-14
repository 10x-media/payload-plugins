import type { JsonObject, PayloadRequest } from 'payload'

import type { ResolvedStep, ResolvedVariant } from '../plugin/registry'
import type {
	AfterSaveAction,
	FormVariantsContext,
	GateResult,
	StepContext,
	WizardState,
} from '../types'

/** The context every server function receives, built once per request per `inDrawer` value. */
export const buildContext = (args: {
	doc: JsonObject | null
	hasPublishedDoc: boolean
	inDrawer: boolean
	operation: 'create' | 'update'
	req: PayloadRequest
}): FormVariantsContext => ({
	doc: args.doc,
	hasPublishedDoc: args.hasPublishedDoc,
	inDrawer: args.inDrawer,
	operation: args.operation,
	req: args.req,
	user: args.req.user,
})

const logDenied = (req: PayloadRequest, what: string, error: unknown): void => {
	req.payload.logger.error({ err: error, msg: `[form-variants] ${what} threw; denying.` })
}

/** Whether one variant's `access` passes. A throwing predicate denies and logs. */
export const passesAccess = async (
	variant: ResolvedVariant,
	ctx: FormVariantsContext
): Promise<boolean> => {
	if (!variant.access) {
		return true
	}
	try {
		return Boolean(await variant.access(ctx))
	} catch (error) {
		logDenied(ctx.req, `access of variant "${variant.key}"`, error)
		return false
	}
}

/** The variants whose `access` passes, in config order. */
export const filterAvailable = async (
	variants: ResolvedVariant[],
	ctx: FormVariantsContext
): Promise<ResolvedVariant[]> => {
	const results = await Promise.all(variants.map((variant) => passesAccess(variant, ctx)))
	return variants.filter((_, index) => results[index])
}

/** Keys of the steps whose `condition` passes or is absent. A throwing condition hides the step. */
export const evaluateVisibility = async (
	variant: ResolvedVariant,
	ctx: StepContext
): Promise<string[]> => {
	const results = await Promise.all(
		variant.steps.map(async (step) => {
			if (!step.condition) {
				return true
			}
			try {
				return Boolean(await step.condition(ctx))
			} catch (error) {
				logDenied(ctx.req, `condition of step "${step.key}"`, error)
				return false
			}
		})
	)
	return variant.steps.filter((_, index) => results[index]).map((step) => step.key)
}

/** Runs a step's gate. A throwing gate blocks with the error's message. */
export const runGate = async (step: ResolvedStep, ctx: StepContext): Promise<GateResult> => {
	if (!step.gate) {
		return { result: 'continue' }
	}
	try {
		return await step.gate(ctx)
	} catch (error) {
		logDenied(ctx.req, `gate of step "${step.key}"`, error)
		return {
			message: error instanceof Error ? error.message : String(error),
			result: 'block',
		}
	}
}

/** Runs a variant's `afterSave`. A throwing hook falls back to Payload's behaviour. */
export const runAfterSave = async (
	variant: ResolvedVariant,
	ctx: FormVariantsContext,
	savedDoc: JsonObject
): Promise<AfterSaveAction> => {
	if (!variant.afterSave) {
		return null
	}
	try {
		return (await variant.afterSave({ ...ctx, savedDoc })) ?? null
	} catch (error) {
		logDenied(ctx.req, `afterSave of variant "${variant.key}"`, error)
		return null
	}
}

/** Builds a step context over a request context; both browser inputs default to empty. */
export const withValues = (
	ctx: FormVariantsContext,
	values: JsonObject | undefined,
	state: WizardState | undefined
): StepContext => ({
	...ctx,
	state: state && typeof state === 'object' ? state : {},
	values: values && typeof values === 'object' ? values : {},
})
