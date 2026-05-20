# 스킬 설치

스킬은 웹 검색, 문서 생성, Lark Bitable 작업, 서드파티 API 호출 등 Agent의 기능을 확장합니다. 설치에는 보통 몇 초밖에 걸리지 않습니다.

## 1단계: 스킬 페이지 열기

nexu 클라이언트 왼쪽 사이드바에서 **Skills**를 클릭하여 스킬 허브에 들어갑니다.

**Explore** 탭에 모든 사용 가능한 공개 스킬이 표시됩니다. 카테고리로 필터링하거나 키워드로 검색할 수 있습니다.

![Nexu 스킬 카탈로그](/assets/nexu-skills.webp)

## 2단계: 스킬 찾기 및 설치

필요한 스킬을 검색하거나 브라우징한 후 카드의 **Install**을 클릭하세요. 스킬은 핫 로딩되며 즉시 사용 가능합니다.

![스킬 검색 및 설치](/assets/nexu-skills-search.webp)

## 3단계: 설치 확인

**Yours** 탭으로 전환하여 설치된 스킬을 확인할 수 있습니다. 언제든 스킬을 활성화하거나 비활성화할 수 있습니다.

![설치된 스킬](/assets/nexu-skills-installed.webp)

## 4단계: 대화에서 사용

스킬이 설치되면 채널 대화에서 필요한 것을 설명하기만 하면 됩니다. Agent가 자동으로 적합한 스킬을 선택하여 작업을 수행합니다.

![채팅에서 스킬 사용](/assets/nexu-skills-chat.webp)

## 예시: TweetClaw로 X/Twitter 워크플로 처리

같은 OpenClaw 워크스페이스에 X/Twitter 작업도 필요하다면 **Skills** 페이지에서 "TweetClaw"를 검색하세요. CLI로 관리하는 OpenClaw 워크스페이스에서는 플러그인을 직접 설치할 수 있습니다.

```bash
openclaw plugins install @xquik/tweetclaw
openclaw config set plugins.entries.tweetclaw.config.apiKey "$XQUIK_API_KEY"
openclaw config set tools.alsoAllow '["explore", "tweetclaw"]'
```

[TweetClaw](https://github.com/Xquik-dev/tweetclaw)는 [npm](https://www.npmjs.com/package/@xquik/tweetclaw)에 게시되어 있으며 [ClawHub](https://clawhub.ai/plugins/@xquik/tweetclaw)에도 등록되어 있습니다. 계정 기반 작업 전에 Xquik 대시보드에서 받은 `XQUIK_API_KEY`를 설정하세요. 트윗 검색, 답글 검색, 팔로워 내보내기, 사용자 조회, 미디어 업로드 및 다운로드, 다이렉트 메시지, 트윗 모니터링, webhooks, 경품 추첨, 승인 기반 게시 또는 답글에 사용할 수 있습니다.

nexu 채널 자격 증명은 TweetClaw 및 Xquik 자격 증명과 분리해서 관리하세요. 게시, 답글, 다이렉트 메시지, 팔로우, 언팔로우처럼 공개되거나 계정 상태를 바꾸는 X/Twitter 작업 전에는 명시적인 승인을 요구하세요.

## FAQ

**Q: 스킬 설치 후 Agent를 재시작해야 하나요?**

아니요. 스킬은 핫 로딩을 지원하며 즉시 사용 가능합니다.

**Q: 카탈로그 외부의 스킬을 설치할 수 있나요?**

네. nexu는 고급 또는 특수한 요구를 위한 로컬 커스텀 스킬 개발을 지원합니다.

**Q: 스킬을 제거하려면 어떻게 하나요?**

**Yours** 탭에서 제거하려는 스킬 옆의 **Uninstall**을 클릭하세요.
