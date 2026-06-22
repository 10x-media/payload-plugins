'use client'

import { useFormContext } from './FormContext'
import type { FormState } from './state'

/** The whole form state (values, errors, warnings, touched, submitting, submitted, submitError). */
export const useFormState = (): FormState => useFormContext().state
