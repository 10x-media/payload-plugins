import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Langganan',
	[keys.subscriptionPlural]: 'Langganan',
	[keys.deliverySingular]: 'Pengiriman',
	[keys.deliveryPlural]: 'Pengiriman',
	[keys.fieldName]: 'Nama',
	[keys.fieldUrl]: 'URL endpoint',
	[keys.fieldEnabled]: 'Aktif',
	[keys.fieldEvents]: 'Event',
	[keys.fieldSecret]: 'Secret penandatanganan',
	[keys.fieldSecretHelp]:
		'Ditampilkan penuh sekali saat dibuat, setelah itu disamarkan. Secret ini menandatangani pengiriman, salin sekarang ke penerima.',
	[keys.fieldHeaders]: 'Header kustom',
	[keys.fieldDescription]: 'Deskripsi',
	[keys.statusPending]: 'Menunggu',
	[keys.statusSuccess]: 'Terkirim',
	[keys.statusFailed]: 'Gagal',
	[keys.statusDead]: 'Dihentikan',
	[keys.redeliver]: 'Kirim ulang',
	[keys.redeliverDone]: 'Pengiriman ulang masuk antrean',
}
