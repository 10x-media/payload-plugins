'use client'

import { useTranslation as usePayloadTranslation } from '@payloadcms/ui'

import type { TranslationKey } from './keys'

/**
 * `useTranslation` bound to this plugin's keys, so `t(keys.X)` typechecks without
 * a per-call `@ts-expect-error`. Returns Payload's `{ t, i18n }` unchanged.
 */
export const useTranslation = () => usePayloadTranslation<Record<string, never>, TranslationKey>()
