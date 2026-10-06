import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.gridView]: 'Tampilkan sebagai grid',
	[keys.listView]: 'Tampilkan sebagai daftar',
	[keys.orderLabel]: 'Urutan',
	[keys.pickManyHint]:
		'Tahan {{modifier}} untuk memilih lebih dari satu, {{range}} untuk memilih rentang.',
	[keys.pluginName]: 'Pemilih Folder',
	[keys.retry]: 'Coba lagi',
	[keys.sortByLabel]: 'Urutkan berdasarkan',
}
