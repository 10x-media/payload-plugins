'use client'

import type { FormStepInfo } from './FormContext'
import { useFormContext } from './FormContext'

/** Multi-step navigation state for the current form (single-step default when the form has no flow). */
export const useFormStep = (): FormStepInfo => useFormContext().step
