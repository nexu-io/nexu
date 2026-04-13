# 핵심 개념

## Agent

Agent는 nexu의 핵심 런타임 유닛으로, 여러 채팅 플랫폼에 연결하고 컨텍스트를 이해하며 작업을 실행하는 영구적인 AI 어시스턴트입니다.

다양한 모델을 설정하고, 다양한 스킬을 설치하여, Agent가 여러 채널에서 사용자와 팀을 지원하도록 할 수 있습니다. 각 워크스페이스는 하나의 Agent 인스턴스를 실행합니다.

![nexu Agent 홈 화면](/assets/nexu-home.webp)

## 채널

채널은 Agent가 사용자와 상호작용하는 곳입니다. nexu는 현재 여러 주요 플랫폼을 지원합니다:

- [Feishu](/ko/guide/channels/feishu) — 중국 팀에서 많이 사용하며, App ID와 App Secret만 있으면 됩니다
- [Slack](/ko/guide/channels/slack) — 글로벌 팀에서 인기가 많으며, 매니페스트 기반 설정 지원
- [Discord](/ko/guide/channels/discord) — 개발자 커뮤니티에서 많이 사용하며, Bot Token으로 연결

자세한 내용은 [채널 설정](/ko/guide/channels)을 참조하세요.

## 모델

모델은 Agent의 추론 품질과 응답 능력을 결정합니다. nexu는 두 가지 통합 경로를 지원합니다:

- **Nexu Official** — API 키 불필요, 빠르게 시작하기에 적합
- **BYOK (Bring Your Own Key)** — 자체 Anthropic, OpenAI, Google AI 또는 기타 OpenAI 호환 프로바이더 연결

기존 대화나 채널 연결에 영향을 주지 않고 언제든 모델을 전환할 수 있습니다.

![모델 설정 화면](/assets/nexu-model-select.webp)

자세한 내용은 [모델 설정](/ko/guide/models)을 참조하세요.

## 스킬

스킬은 Agent의 확장성 시스템입니다. 각 스킬은 데이터 조회, 문서 생성, 스프레드시트 작업, 서드파티 API 호출 등 Agent에게 특정 기능을 부여하는 독립 모듈입니다.

nexu는 원클릭 설치를 위한 스킬 카탈로그를 제공하며, 고급 워크플로를 위한 로컬 커스텀 스킬 개발도 지원합니다.

![스킬 카탈로그](/assets/nexu-skills.webp)

자세한 내용은 [스킬 설치](/ko/guide/skills)를 참조하세요.
