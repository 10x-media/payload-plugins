'use client'

import { useConfig, useDocumentInfo, useForm, useFormFields, useLocale } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { CheckResponse } from '../plugin/registerEndpoints'
import { answerCache, callApi } from './api'

export type DuplicateCandidate = CheckResponse['candidates'][number]

/**
 * Answers shared by every caller on the page, keyed by the values they were asked for: the
 * sidebar has usually checked the exact values the save button is about to ask about.
 */
const remember = answerCache<DuplicateCandidate[]>(5_000)

export type UseDuplicateCheckArgs = {
	collection: string
	/** The match field paths; a change to any of them asks again. */
	paths: string[]
	/** Quiet time after the last change before the sidebar asks. */
	delay?: number
	/** `false` asks only through `check`, not as the form changes. */
	follow?: boolean
}

/**
 * Saved documents that resemble the form's current values. `candidates` follows the form
 * as it is typed into; `check` asks right away, for a save that cannot wait for the delay.
 */
export const useDuplicateCheck = ({
	collection,
	paths,
	delay = 500,
	follow = true,
}: UseDuplicateCheckArgs) => {
	const { id } = useDocumentInfo()
	const { getData } = useForm()
	// The candidates are named in the language the admin shows.
	const { code: locale } = useLocale()
	const {
		config: {
			routes: { api: apiRoute },
		},
	} = useConfig()
	const watched = useFormFields(([fields]) =>
		JSON.stringify(paths.map((path) => fields[path]?.value ?? null))
	)
	const [candidates, setCandidates] = useState<DuplicateCandidate[]>([])
	// Opening a document is not typing: its first check has nothing to wait for.
	const settled = useRef(false)

	const check = useCallback(
		(): Promise<DuplicateCandidate[]> =>
			remember(`${collection}|${id ?? ''}|${locale ?? ''}|${watched}`, async () => {
				const response = await callApi<CheckResponse>({
					apiRoute,
					path: `/dedupe/check${locale ? `?locale=${locale}` : ''}`,
					method: 'POST',
					body: { collection, id: id ?? null, data: getData() },
				})
				return response.candidates
			}),
		[apiRoute, collection, getData, id, locale, watched]
	)

	useEffect(() => {
		if (!follow) return
		const values = JSON.parse(watched) as unknown[]
		if (values.every((value) => value === null || value === '')) {
			setCandidates([])
			return
		}
		let current = true
		const timer = setTimeout(
			() => {
				settled.current = true
				check()
					.then((found) => current && setCandidates(found))
					.catch(() => current && setCandidates([]))
			},
			settled.current ? delay : 0
		)
		return () => {
			current = false
			clearTimeout(timer)
		}
	}, [check, delay, follow, watched])

	return { candidates, check }
}
