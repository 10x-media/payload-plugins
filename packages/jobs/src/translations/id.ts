import { keys, type TranslationKey } from './keys'

export const id: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Pekerjaan',

	[keys.statusQueued]: 'Dalam antrean',
	[keys.statusScheduled]: 'Terjadwal',
	[keys.statusRetrying]: 'Mencoba lagi',
	[keys.statusRunning]: 'Berjalan',
	[keys.statusSucceeded]: 'Berhasil',
	[keys.statusFailed]: 'Gagal',
	[keys.statusCancelled]: 'Dibatalkan',

	[keys.fieldStatus]: 'Status',
	[keys.fieldWorkflow]: 'Alur kerja',
	[keys.fieldTask]: 'Tugas',
	[keys.fieldJob]: 'Pekerjaan',
	[keys.fieldQueue]: 'Antrean',
	[keys.fieldAttempts]: 'Percobaan',
	[keys.fieldCreated]: 'Dibuat',
	[keys.fieldUpdated]: 'Diperbarui',
	[keys.fieldCompleted]: 'Selesai',
	[keys.fieldExecuted]: 'Dieksekusi',
	[keys.fieldTaskId]: 'ID Tugas',
	[keys.fieldInput]: 'Masukan',
	[keys.fieldOutput]: 'Keluaran',
	[keys.fieldError]: 'Kesalahan',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: 'Dimulai',
	[keys.fieldLeaseExpires]: 'Masa sewa berakhir',
	[keys.fieldScheduledFor]: 'Dijadwalkan untuk',

	[keys.outcome]: 'Hasil',
	[keys.noAttempts]: 'Belum ada percobaan yang tercatat.',
	[keys.copy]: 'Salin',
	[keys.copied]: 'Disalin',
	[keys.jobSingular]: 'pekerjaan',
	[keys.jobPlural]: 'pekerjaan',
	[keys.errorWorkflowTaskExclusive]:
		'Sebuah pekerjaan menjalankan alur kerja atau tugas, bukan keduanya.',
	[keys.cronBadge]: 'Cron',
	[keys.attemptsTooltip]: 'Percobaan eksekusi untuk pekerjaan ini, termasuk percobaan ulang',
	[keys.inlineStep]: 'inline: {{id}}',
}
