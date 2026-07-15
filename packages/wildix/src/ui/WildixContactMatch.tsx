'use client'

import { useFormFields } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'

type WildixContact = { name: string; phone: string }

type Props = {
	phoneNumberFields?: string[]
}

const normalizeNumber = (num: string) => num.replace(/\D/g, '')

const WildixContactMatch = ({ phoneNumberFields = [] }: Props) => {
	const [contacts, setContacts] = useState<WildixContact[]>([])
	const [loading, setLoading] = useState(true)
	const [notConnected, setNotConnected] = useState(false)

	const formPhoneValues = useFormFields(([fields]) =>
		phoneNumberFields
			.map((name) => fields[name]?.value as string | undefined)
			.filter((v): v is string => Boolean(v))
	)

	useEffect(() => {
		fetch('/api/wildix/contacts')
			.then((res) => {
				if (res.status === 403) {
					setNotConnected(true)
					setLoading(false)
					return
				}
				return res.json().then((data: { contacts: WildixContact[] }) => {
					setContacts(data.contacts ?? [])
					setLoading(false)
				})
			})
			.catch(() => setLoading(false))
	}, [])

	const normalizedFormNumbers = useMemo(
		() => formPhoneValues.map(normalizeNumber).filter(Boolean),
		[formPhoneValues]
	)

	const matchedContacts = useMemo(() => {
		if (contacts.length === 0 || normalizedFormNumbers.length === 0) return []
		return contacts.filter((contact) =>
			normalizedFormNumbers.includes(normalizeNumber(contact.phone))
		)
	}, [contacts, normalizedFormNumbers])

	if (loading) return <div>Loading contacts...</div>

	if (notConnected) return null

	if (matchedContacts.length === 0) return null

	return (
		<div>
			<h3>Matched Contacts</h3>
			{matchedContacts.map((contact) => (
				<div key={contact.phone}>
					<strong>{contact.name}</strong>
					<p>{contact.phone}</p>
				</div>
			))}
		</div>
	)
}

export default WildixContactMatch
