import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'Langganan',
	[keys.subscriptionPlural]: 'Langganan',
	[keys.deliverySingular]: 'Pengiriman',
	[keys.deliveryPlural]: 'Pengiriman',
	[keys.fieldName]: 'Nama',
	[keys.fieldUrl]: 'URL endpoint',
	[keys.urlInvalid]: 'Masukkan URL absolut dengan http:// atau https://.',
	[keys.urlHostNotAllowed]: 'Host ini tidak ada dalam daftar host webhook yang diizinkan.',
	[keys.fieldEnabled]: 'Aktif',
	[keys.fieldEvents]: 'Event',
	[keys.fieldSecret]: 'Secret penandatanganan',
	[keys.fieldSecretHelp]:
		'Digunakan untuk menandatangani pengiriman. Disimpan terenkripsi dan tidak pernah ditampilkan lagi setelah disimpan, jadi salin ke penerima sekarang. Jika hilang, rotasi saja alih-alih mencarinya.',
	[keys.fieldPreviousSecretExpires]: 'Secret sebelumnya berlaku hingga',
	[keys.fieldPreviousSecretExpiresHelp]:
		'Selama diisi, pengiriman membawa tanda tangan dari secret saat ini dan secret sebelumnya. Setelah waktu ini hanya secret saat ini yang menandatangani.',
	[keys.rotateSecret]: 'Rotasi secret',
	[keys.rotateSecretTitle]: 'Rotasi secret penandatanganan',
	[keys.rotateSecretAcknowledge]: 'Sudah saya simpan',
	[keys.rotateSecretCopy]: 'Salin',
	[keys.rotateSecretCopied]: 'Tersalin',
	[keys.rotateSecretCopyFailed]: 'Tidak dapat menyalin secara otomatis. Pilih secret lalu salin.',
	[keys.rotateSecretRevealTitle]: 'Secret penandatanganan baru',
	[keys.rotateSecretRevealBody]:
		'Secret ini hanya ditampilkan kali ini saja. Salin ke penerima Anda sebelum menutup dialog ini.',
	[keys.rotateSecretDone]: 'Secret dirotasi',
	[keys.rotateSecretFailed]: 'Tidak dapat merotasi secret',
	[keys.rotateSecretConfirm]:
		'Rotasi secret penandatanganan ini? Secret saat ini tetap berfungsi selama masa tenggang, lalu berhenti. Anda hanya akan melihat secret baru satu kali.',
	[keys.rotateSecretForbidden]: 'Anda tidak memiliki izin untuk merotasi secret ini',
	[keys.rotateSecretConflict]:
		'Langganan ini berubah saat rotasi berlangsung. Muat ulang dan coba lagi jika Anda masih memerlukan secret baru',
	[keys.rotateSecretRejected]: 'Rotasi ditolak. Periksa secret yang Anda berikan',
	[keys.fieldHeaders]: 'Header kustom',
	[keys.headerReserved]:
		"'{{name}}' diatur oleh plugin atau transport HTTP pada setiap pengiriman dan tidak dapat ditimpa.",
	[keys.headerInvalid]:
		"'{{name}}' bukan nama header HTTP yang valid. Gunakan huruf, angka, dan karakter !#$%&'*+-.^_`|~ tanpa spasi.",
	[keys.headerValueInvalid]: 'Nilai header tidak boleh berisi baris baru.',
	[keys.fieldDescription]: 'Deskripsi',
	[keys.statusPending]: 'Menunggu',
	[keys.statusSuccess]: 'Terkirim',
	[keys.statusFailed]: 'Gagal',
	[keys.statusDead]: 'Dihentikan',
	[keys.redeliver]: 'Kirim ulang',
	[keys.redeliverDone]: 'Pengiriman ulang masuk antrean',
	[keys.redeliverSent]: 'Terkirim ulang',
	[keys.redeliverFailed]: 'Tidak dapat mengirim ulang',
	[keys.redeliverConfirm]:
		'Kirim payload ini lagi? Payload dikirim sebagai pengiriman baru dengan webhook-id baru, sehingga penerima yang melakukan deduplikasi berdasarkan id akan memprosesnya untuk kedua kalinya.',
}
