import { keys, type TranslationKey } from './keys'

export const ko: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Webhooks',
	[keys.subscriptionSingular]: '구독',
	[keys.subscriptionPlural]: '구독',
	[keys.deliverySingular]: '전송',
	[keys.deliveryPlural]: '전송 내역',
	[keys.fieldName]: '이름',
	[keys.fieldUrl]: '엔드포인트 URL',
	[keys.urlInvalid]: 'http:// 또는 https://로 시작하는 절대 URL을 입력하세요.',
	[keys.urlHostNotAllowed]: '이 호스트는 허용된 웹훅 호스트 목록에 없습니다.',
	[keys.urlNotHttps]:
		'https:// URL을 입력하세요. 웹훅 엔드포인트에는 암호화되지 않은 http://를 사용할 수 없습니다.',
	[keys.urlPrivateAddress]:
		'이 주소는 사설, 로컬 또는 공개적으로 접근할 수 없는 주소이므로 웹훅을 보낼 수 없습니다.',
	[keys.fieldEnabled]: '활성화됨',
	[keys.fieldEvents]: '이벤트',
	[keys.fieldSecret]: '서명 시크릿',
	[keys.fieldSecretHelp]:
		'전송에 서명할 때 쓰입니다. 암호화되어 저장되며 저장한 뒤에는 다시 표시되지 않으니 지금 수신 측에 복사해 두세요. 잃어버렸다면 찾으려 하지 말고 교체하세요.',
	[keys.fieldPreviousSecretExpires]: '이전 시크릿 유효 기한',
	[keys.fieldPreviousSecretExpiresHelp]:
		'값이 있는 동안에는 전송에 현재 시크릿과 이전 시크릿의 서명이 모두 포함됩니다. 이 시각 이후에는 현재 시크릿만 서명합니다.',
	[keys.rotateSecret]: '시크릿 교체',
	[keys.rotateSecretTitle]: '서명 시크릿 교체',
	[keys.rotateSecretAcknowledge]: '저장했습니다',
	[keys.rotateSecretCopy]: '복사',
	[keys.rotateSecretCopied]: '복사됨',
	[keys.rotateSecretCopyFailed]: '자동으로 복사하지 못했습니다. 시크릿을 선택해서 복사하세요.',
	[keys.rotateSecretRevealTitle]: '새 서명 시크릿',
	[keys.rotateSecretRevealBody]:
		'이 시크릿은 지금 한 번만 표시됩니다. 이 대화 상자를 닫기 전에 수신 측에 복사해 두세요.',
	[keys.rotateSecretDone]: '시크릿을 교체했습니다',
	[keys.rotateSecretFailed]: '시크릿을 교체하지 못했습니다',
	[keys.rotateSecretConfirm]:
		'이 서명 시크릿을 교체할까요? 현재 시크릿은 유예 기간 동안 계속 동작한 뒤 중단됩니다. 새 시크릿은 한 번만 표시됩니다.',
	[keys.rotateSecretForbidden]: '이 시크릿을 교체할 권한이 없습니다',
	[keys.rotateSecretConflict]:
		'교체하는 동안 이 구독이 변경되었습니다. 새 시크릿이 여전히 필요하다면 새로 고친 뒤 다시 시도하세요',
	[keys.rotateSecretRejected]: '교체가 거부되었습니다. 입력한 시크릿을 확인하세요',
	[keys.fieldHeaders]: '사용자 정의 헤더',
	[keys.headerReserved]:
		"'{{name}}'은(는) 플러그인 또는 HTTP 전송 계층이 모든 전송에 설정하므로 덮어쓸 수 없습니다.",
	[keys.headerInvalid]:
		"'{{name}}'은(는) 올바른 HTTP 헤더 이름이 아닙니다. 공백 없이 영문자, 숫자, 그리고 !#$%&'*+-.^_`|~ 문자만 사용하세요.",
	[keys.headerValueInvalid]: '헤더 값에는 줄바꿈을 넣을 수 없습니다.',
	[keys.fieldDescription]: '설명',
	[keys.statusPending]: '대기 중',
	[keys.statusSuccess]: '전송됨',
	[keys.statusFailed]: '실패',
	[keys.statusDead]: '중단됨',
	[keys.redeliver]: '다시 전송',
	[keys.redeliverDone]: '재전송이 대기열에 추가되었습니다',
	[keys.redeliverSent]: '다시 전송했습니다',
	[keys.redeliverFailed]: '다시 전송하지 못했습니다',
	[keys.redeliverConfirm]:
		'이 페이로드를 다시 보낼까요? 새 webhook-id가 붙은 새 전송으로 나가므로, id로 중복을 걸러내는 수신 측은 이를 한 번 더 처리합니다.',
}
