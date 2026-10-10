import { keys, type TranslationKey } from './keys'

export const ar: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: 'اشتراك',
	[keys.subscriptionPlural]: 'الاشتراكات',
	[keys.deliverySingular]: 'تسليم',
	[keys.deliveryPlural]: 'عمليات التسليم',
	[keys.fieldName]: 'الاسم',
	[keys.fieldUrl]: 'عنوان URL لنقطة النهاية',
	[keys.urlInvalid]: 'أدخل عنوان URL مطلقًا يبدأ بـ http:// أو https://.',
	[keys.urlHostNotAllowed]: 'هذا المضيف غير مدرج في قائمة المضيفين المسموح بهم لـ Webhooks.',
	[keys.urlNotHttps]:
		'أدخل عنوان URL يبدأ بـ https://. لا يُسمح باستخدام http:// غير المشفّر لنقاط نهاية الويب هوك.',
	[keys.urlPrivateAddress]:
		'هذا العنوان خاص أو محلي أو غير قابل للوصول من الإنترنت، لذلك لا يمكن إرسال الويب هوك إليه.',
	[keys.fieldEnabled]: 'مفعّل',
	[keys.fieldEvents]: 'الأحداث',
	[keys.fieldSecret]: 'مفتاح التوقيع السري',
	[keys.fieldSecretHelp]:
		'يُستخدم لتوقيع عمليات التسليم. يُخزَّن مشفّرًا ولا يُعرض مجددًا بعد الحفظ، لذا انسخه إلى المستقبِل الآن. وإذا فقدته فدوِّره بدل البحث عنه.',
	[keys.fieldPreviousSecretExpires]: 'المفتاح السابق صالح حتى',
	[keys.fieldPreviousSecretExpiresHelp]:
		'ما دامت هذه القيمة محددة، تحمل عمليات التسليم توقيعًا من المفتاح الحالي وآخر من المفتاح السابق. بعد هذا الوقت يوقّع المفتاح الحالي فقط.',
	[keys.rotateSecret]: 'تدوير المفتاح السري',
	[keys.rotateSecretTitle]: 'تدوير مفتاح التوقيع السري',
	[keys.rotateSecretAcknowledge]: 'لقد حفظته',
	[keys.rotateSecretCopy]: 'نسخ',
	[keys.rotateSecretCopied]: 'تم النسخ',
	[keys.rotateSecretCopyFailed]: 'تعذّر النسخ تلقائيًا. حدّد المفتاح السري وانسخه.',
	[keys.rotateSecretRevealTitle]: 'مفتاح توقيع سري جديد',
	[keys.rotateSecretRevealBody]:
		'هذه هي المرة الوحيدة التي يُعرض فيها هذا المفتاح. انسخه إلى المستقبِل قبل إغلاق هذه النافذة.',
	[keys.rotateSecretDone]: 'تم تدوير المفتاح السري',
	[keys.rotateSecretFailed]: 'تعذّر تدوير المفتاح السري',
	[keys.rotateSecretConfirm]:
		'هل تريد تدوير مفتاح التوقيع السري هذا؟ يستمر المفتاح الحالي في العمل خلال فترة السماح ثم يتوقف. سترى المفتاح الجديد مرة واحدة فقط.',
	[keys.rotateSecretForbidden]: 'ليس لديك إذن لتدوير هذا المفتاح السري',
	[keys.rotateSecretConflict]:
		'تغيّر هذا الاشتراك أثناء التدوير. أعد التحميل وحاول مجددًا إن كنت ما زلت بحاجة إلى مفتاح جديد',
	[keys.rotateSecretRejected]: 'رُفض التدوير. تحقق من المفتاح السري الذي أدخلته',
	[keys.fieldHeaders]: 'ترويسات مخصصة',
	[keys.headerReserved]:
		"تضبط الإضافة أو طبقة نقل HTTP الترويسة '{{name}}' في كل عملية تسليم ولا يمكن تجاوزها.",
	[keys.headerInvalid]:
		"'{{name}}' ليس اسم ترويسة HTTP صالحًا. استخدم الأحرف والأرقام وأيًّا من الرموز !#$%&'*+-.^_`|~ دون مسافات.",
	[keys.headerValueInvalid]: 'لا يمكن أن تحتوي قيمة الترويسة على فواصل أسطر.',
	[keys.fieldDescription]: 'الوصف',
	[keys.statusPending]: 'قيد الانتظار',
	[keys.statusSuccess]: 'تم التسليم',
	[keys.statusFailed]: 'فشل',
	[keys.statusDead]: 'متوقف نهائيًا',
	[keys.redeliver]: 'إعادة التسليم',
	[keys.redeliverDone]: 'تمت جدولة إعادة التسليم',
	[keys.redeliverSent]: 'تمت إعادة التسليم',
	[keys.redeliverFailed]: 'تعذّرت إعادة التسليم',
	[keys.redeliverConfirm]:
		'هل تريد إرسال هذه الحمولة مجددًا؟ ستُرسل كعملية تسليم جديدة بمعرّف webhook-id جديد، ولذلك فإن المستقبِل الذي يزيل التكرار اعتمادًا على المعرّف سيعالجها مرة ثانية.',
}
