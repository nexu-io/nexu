# 모델 설정

Nexu는 두 가지 모델 통합 경로를 지원합니다: **Nexu Official** (관리형 모델, 로그인 후 바로 사용)과 **BYOK** (Bring Your Own Key). 기존 대화나 채널 연결에 영향을 주지 않고 언제든 전환할 수 있습니다.

## 1단계: 설정 열기

nexu 클라이언트 왼쪽 사이드바에서 **설정**을 클릭하여 AI 모델 프로바이더 설정 페이지를 엽니다.

![설정 페이지 열기](/assets/nexu-settings-open.webp)

## 2단계: 통합 모드 선택

### 옵션 A: Nexu Official

왼쪽 프로바이더 목록에서 **Nexu Official**을 선택하고 **Sign in to Nexu**를 클릭하여 인증하세요.

로그인하면 API 키가 필요 없습니다. 관리형 모델을 즉시 사용할 수 있습니다.

![Nexu Official 모델 설정](/assets/nexu-models-official.webp)

### 옵션 B: Bring Your Own Key

목록에서 **Anthropic**, **OpenAI**, **Google AI** 또는 기타 프로바이더를 선택하세요:

1. **API Key** 필드에 키를 붙여넣으세요.
2. 커스텀 프록시가 필요하면 **API Proxy URL**을 수정하세요.
3. **Save**를 클릭하세요. nexu가 키를 검증하고 사용 가능한 모델 목록을 자동으로 불러옵니다.

![BYOK 모델 설정](/assets/nexu-models-byok.webp)

## 3단계: 활성 모델 선택

연결에 성공하면 설정 페이지 상단의 **Nexu Bot Model** 드롭다운을 사용하여 Agent가 사용할 모델을 선택하세요.

![활성 모델 선택](/assets/nexu-model-select.webp)

## 지원 프로바이더

| 프로바이더 | 기본 Base URL | 키 형식 |
| --- | --- | --- |
| Anthropic | `https://api.anthropic.com` | `sk-ant-...` |
| OpenAI | `https://api.openai.com/v1` | `sk-...` |
| Google AI | `https://generativelanguage.googleapis.com/v1beta` | `AIza...` |
| xAI | `https://api.x.ai/v1` | `xai-...` |
| Custom | OpenAI 호환 엔드포인트 | 프로바이더에 따라 다름 |

## 모범 사례

- 가능하면 최소 권한 API 키를 사용하세요.
- 스크린샷, 티켓, git 히스토리에 키를 노출하지 마세요.
- BYOK 프로바이더를 추가할 때 저장하기 전에 연결을 확인하세요.
- 프록시, 자체 호스팅 게이트웨이 또는 기타 OpenAI 호환 추론 서비스가 필요하면 **Custom**을 사용하세요.

## FAQ

**Q: 어떤 모드로 시작해야 하나요?**

Nexu Official이 가장 쉽습니다: 로그인하고 관리형 모델을 바로 사용하세요.

**Q: 여러 BYOK 프로바이더를 동시에 설정할 수 있나요?**

네. 프로바이더는 독립적으로 설정할 수 있으며, 모델 선택기를 통해 전환할 수 있습니다.

**Q: API 키가 nexu 서버에 업로드되나요?**

아니요. API 키는 로컬 기기에 저장되며 nexu 서버에 업로드되지 않습니다.
