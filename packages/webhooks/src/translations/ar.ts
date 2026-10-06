import { keys, type TranslationKey } from './keys'

export const ar: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'اشتراك',
	[keys.subscriptionPlural]: 'الاشتراكات',
	[keys.deliverySingular]: 'تسليم',
	[keys.deliveryPlural]: 'عمليات التسليم',
	[keys.fieldName]: 'الاسم',
	[keys.fieldUrl]: 'عنوان URL لنقطة النهاية',
	[keys.fieldEnabled]: 'مفعّل',
	[keys.fieldEvents]: 'الأحداث',
	[keys.fieldSecret]: 'مفتاح التوقيع السري',
	[keys.fieldSecretHelp]:
		'يظهر كاملاً مرة واحدة عند الإنشاء، ثم يُخفى بعد ذلك. يوقّع عمليات التسليم، انسخه إلى المستقبِل الآن.',
	[keys.fieldHeaders]: 'ترويسات مخصصة',
	[keys.fieldDescription]: 'الوصف',
	[keys.statusPending]: 'قيد الانتظار',
	[keys.statusSuccess]: 'تم التسليم',
	[keys.statusFailed]: 'فشل',
	[keys.statusDead]: 'متوقف نهائيًا',
	[keys.redeliver]: 'إعادة التسليم',
	[keys.redeliverDone]: 'تمت جدولة إعادة التسليم',
}
