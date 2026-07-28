'use client'

import { useFormContext } from './FormContext'

/**
 * Live computed calculation values (field name -> number), recomputed as answers change. For
 * composed frontends (custom layouts over `useFormContext`/`FormFields`) that render running
 * totals without re-evaluating expressions themselves.
 */
export const useCalcValues = (): Record<string, number> => useFormContext().calcValues ?? {}
