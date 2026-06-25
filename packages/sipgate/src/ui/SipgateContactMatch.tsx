'use client'

import { useFormFields } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'
import type { SipgateContact } from '../types'

type Props = {
	phoneNumberFields?: string[]
}

const normalizeNumber = (num: string) => num.replace(/\D/g, '')

const SipgateContactMatch = ({ phoneNumberFields = [] }: Props) => {
	const [contacts, setContacts] = useState<SipgateContact>()
	const [loading, setLoading] = useState(true)

	const formPhoneValues = useFormFields(([fields]) =>
		phoneNumberFields
			.map((name) => fields[name]?.value as string | undefined)
			.filter((v): v is string => Boolean(v))
	)

	useEffect(() => {
		fetch('/api/sipgate/contacts')
			.then((res) => res.json())
			.then((data) => {
				setContacts(data)
				setLoading(false)
			})
	}, [])

	const normalizedFormNumbers = useMemo(
		() => formPhoneValues.map(normalizeNumber).filter(Boolean),
		[formPhoneValues]
	)

	const matchedContacts = useMemo(() => {
		if (!contacts?.items || normalizedFormNumbers.length === 0) return []
		return contacts.items.filter((contact) =>
			contact.numbers.some((n) => normalizedFormNumbers.includes(normalizeNumber(n.number)))
		)
	}, [contacts, normalizedFormNumbers])

	if (loading) return <div>Loading contacts...</div>

	if (matchedContacts.length === 0) return null

	return (
		<div>
			<h3>Matched Contacts</h3>
			{matchedContacts.map((contact) => (
				<div key={contact.id}>
					<strong>
						{contact.givenname} {contact.familyname}
					</strong>
					<p>{contact.numbers.map((n) => n.number).join(', ')}</p>
				</div>
			))}
		</div>
	)
}

export default SipgateContactMatch
