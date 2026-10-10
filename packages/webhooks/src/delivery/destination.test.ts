import { describe, expect, it } from 'vitest'
import { isPublicAddress, type UrlPolicy, urlRefusal } from './destination'

const strict: UrlPolicy = { allowHttp: false, allowPrivateAddresses: false }

describe('isPublicAddress', () => {
	it.each([
		'127.0.0.1',
		'10.0.0.1',
		'172.16.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'255.255.255.255',
		'224.0.0.1',
		'198.18.0.1',
		'::1',
		'::',
		'fe80::1',
		'fe80::1%eth0',
		'fc00::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1',
		'64:ff9b::7f00:1',
		'2002:7f00:1::',
		'2001:db8::1',
		// Ranges ipaddr.js files under plain unicast, each a way to an internal host.
		'::7f00:1',
		'::127.0.0.1',
		'64:ff9b:1::7f00:1',
		'fec0::1',
		'not-an-ip',
		'',
	])('refuses %s', (address) => {
		expect(isPublicAddress(address)).toBe(false)
	})

	it.each([
		'1.1.1.1',
		'93.184.216.34',
		'::ffff:1.1.1.1',
		'2606:4700:4700::1111',
	])('allows %s', (address) => {
		expect(isPublicAddress(address)).toBe(true)
	})
})

describe('urlRefusal', () => {
	/** Every spelling here is 127.0.0.1 or an internal address once the URL parser has read it. */
	it.each([
		'https://127.0.0.1/hook',
		'https://2130706433/hook',
		'https://0x7f.0.0.1/hook',
		'https://127.1/hook',
		'https://017700000001/hook',
		'https://[::1]/hook',
		'https://[::ffff:127.0.0.1]/hook',
		'https://169.254.169.254/latest/meta-data',
		'https://10.0.0.5:8443/hook',
		'https://[::7f00:1]/hook',
		'https://[fec0::1]/hook',
	])('refuses %s as a private address', (url) => {
		expect(urlRefusal(url, strict, 'collection')).toBe('private')
	})

	it('refuses plain http unless allowed', () => {
		expect(urlRefusal('http://hooks.example.com/x', strict, 'collection')).toBe('insecure')
		expect(
			urlRefusal('http://hooks.example.com/x', { ...strict, allowHttp: true }, 'collection')
		).toBe(null)
	})

	it('refuses a URL that is not absolute http(s), or carries credentials', () => {
		expect(urlRefusal('ftp://hooks.example.com', strict, 'collection')).toBe('invalid')
		expect(urlRefusal('/relative', strict, 'collection')).toBe('invalid')
		expect(urlRefusal('https://user:pw@hooks.example.com', strict, 'collection')).toBe('invalid')
	})

	it('allows a public https URL, and a private one once the install opts in', () => {
		expect(urlRefusal('https://hooks.example.com/x', strict, 'collection')).toBe(null)
		expect(
			urlRefusal('https://127.0.0.1/x', { ...strict, allowPrivateAddresses: true }, 'collection')
		).toBe(null)
	})

	it('still applies the host allowlist first', () => {
		const listed: UrlPolicy = { ...strict, allowedHosts: ['hooks.example.com'] }
		expect(urlRefusal('https://elsewhere.test/x', listed, 'collection')).toBe('host')
		expect(urlRefusal('https://hooks.example.com/x', listed, 'collection')).toBe(null)
	})

	/** A code subscription's URL lives in the repository, so only the allowlist judges it. */
	it('exempts code subscriptions from the scheme and address rules, not from the allowlist', () => {
		expect(urlRefusal('http://127.0.0.1:9000/hook', strict, 'code')).toBe(null)
		expect(
			urlRefusal('http://127.0.0.1:9000/hook', { ...strict, allowedHosts: ['x.test'] }, 'code')
		).toBe('host')
	})
})
