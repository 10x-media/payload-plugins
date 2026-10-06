'use client'

import {
	Button,
	useConfig,
	useDocumentInfo,
	useForm,
	useFormInitializing,
	useOperation,
} from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useRef } from 'react'

/**
 * Dev stand only: build a look-alike of a customer and open the create form with it
 * typed in, so the check on save has something to catch.
 */

const STORAGE_KEY = 'dedupe-dev-near-duplicate'
// `tenant` too, so the copy lands in the same office as the original and meets it.
const FIELDS = ['tenant', 'name', 'email', 'phone', 'birthDate', 'vip', 'company', 'tags'] as const

type Values = Partial<Record<(typeof FIELDS)[number], unknown>>

/** Swap the two middle letters of the longest word: a typo the name preset forgives. */
const typo = (name: string): string => {
	const words = name.split(' ')
	const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '')
	if (longest.length < 5) return words.reverse().join(' ')
	const i = Math.floor(longest.length / 2)
	const swapped = longest.slice(0, i - 1) + longest[i] + longest[i - 1] + longest.slice(i + 1)
	return words.map((word) => (word === longest ? swapped : word)).join(' ')
}

/** The same number written another way: digits kept, spacing and prefix changed. */
const reformatPhone = (phone: string): string => {
	const digits = phone.replace(/\D/g, '')
	const tail = digits.slice(-9)
	return `0${tail.slice(0, 3)} ${tail.slice(3, 6)} ${tail.slice(6)}`
}

const lookAlike = (source: Values): Values => {
	const name = typeof source.name === 'string' ? source.name : ''
	const email = typeof source.email === 'string' ? source.email : ''
	const phone = typeof source.phone === 'string' ? source.phone : ''
	const [local, domain] = email.split('@')
	return {
		...source,
		name: Math.random() < 0.5 ? typo(name) : name.split(' ').reverse().join(' '),
		// `email` is unique, so the copy gets its own; the rest carries the resemblance.
		email: local && domain ? `${local}.copy${Date.now() % 1000}@${domain}` : undefined,
		phone: phone ? reformatPhone(phone) : undefined,
	}
}

const pickFields = (doc: Record<string, unknown>): Values => {
	const out: Values = {}
	for (const field of FIELDS) {
		const value = doc[field]
		if (value === undefined || value === null) continue
		out[field] = typeof value === 'object' && 'id' in value ? (value as { id: unknown }).id : value
	}
	return out
}

const useOpenCreate = () => {
	const router = useRouter()
	const {
		config: {
			routes: { admin: adminRoute, api: apiRoute },
		},
	} = useConfig()
	const open = (source: Record<string, unknown> | undefined) => {
		if (!source) return
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lookAlike(pickFields(source))))
		router.push(formatAdminURL({ adminRoute, path: '/collections/customers/create' }))
	}
	return { apiRoute, open }
}

const label = 'Dev: create near-duplicate'

/** On a customer's own page: copies the values in the form. */
export function NearDuplicateButton() {
	const { id } = useDocumentInfo()
	const { getData } = useForm()
	const { open } = useOpenCreate()
	if (!id) return null
	return (
		<Button buttonStyle="secondary" margin={false} onClick={() => open(getData())} size="small">
			{label}
		</Button>
	)
}

/** Above the customers list: copies a random saved customer. */
export function NearDuplicateListButton() {
	const { apiRoute, open } = useOpenCreate()
	const go = async () => {
		const response = await fetch(`${apiRoute}/customers?limit=100&depth=0`, {
			credentials: 'include',
		})
		const { docs } = (await response.json()) as { docs: Record<string, unknown>[] }
		// A customer saved with nothing in it would make an empty copy.
		const usable = docs.filter((doc) => typeof doc.name === 'string' && doc.name !== '')
		open(usable[Math.floor(Math.random() * usable.length)])
	}
	return (
		<div style={{ marginBottom: 'var(--base)' }}>
			<Button buttonStyle="secondary" margin={false} onClick={() => void go()} size="small">
				{label}
			</Button>
		</div>
	)
}

/** A UI field on the create form that types in the look-alike the button left behind. */
export function DevPrefill() {
	const operation = useOperation()
	const initializing = useFormInitializing()
	const { dispatchFields, setModified } = useForm()
	const done = useRef(false)

	useEffect(() => {
		if (done.current || initializing || operation !== 'create') return
		const stored = sessionStorage.getItem(STORAGE_KEY)
		if (!stored) return
		done.current = true
		sessionStorage.removeItem(STORAGE_KEY)
		const values = JSON.parse(stored) as Values
		for (const [path, value] of Object.entries(values)) {
			if (value !== undefined) dispatchFields({ type: 'UPDATE', path, value })
		}
		setModified(true)
	}, [dispatchFields, initializing, operation, setModified])

	return null
}
