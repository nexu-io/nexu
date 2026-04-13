# 문제 해결

## 문제 1: nexu가 시작되지 않거나 OpenClaw과 충돌

**증상:** nexu가 시작 후 응답하지 않거나, 즉시 충돌하거나, 포트가 이미 사용 중이라는 오류가 표시됩니다.

**원인:** OpenClaw 백그라운드 게이트웨이 서비스(`ai.openclaw.gateway`)가 필요한 포트를 점유하고 있어 nexu가 올바르게 시작되지 않습니다.

**해결 방법:**

1. 터미널을 열고 다음 명령어를 하나씩 실행하세요:

```bash
launchctl bootout gui/$(id -u)/ai.openclaw.gateway
rm ~/Library/LaunchAgents/ai.openclaw.gateway.plist
```

> 첫 번째 명령어는 OpenClaw 게이트웨이 서비스를 즉시 중지합니다. 두 번째는 자동 시작 설정을 제거하여 재부팅 후 다시 충돌하지 않도록 합니다.

2. nexu를 다시 열고 정상적으로 시작되는지 확인하세요.

---

## 문제 2: 설치 또는 업데이트 중 "Nexu.app이 사용 중"

**증상:** macOS에서 `Nexu.app`이 현재 사용 중이어서 작업을 완료할 수 없다는 메시지가 표시됩니다.

![Nexu.app이 사용 중](/assets/nexu-app-in-use.webp)

**원인:** nexu 백그라운드 프로세스가 여전히 실행 중이어서 macOS가 이전 앱 번들을 교체할 수 없습니다.

**해결 방법:**

1. 터미널을 열고 다음 명령어를 실행하여 모든 nexu 관련 프로세스를 중지하세요:

```bash
curl -fsSL https://desktop-releases.nexu.io/scripts/kill-all.sh | bash
```

2. 스크립트가 완료되면 nexu를 재설치하거나 새 `Nexu.app`을 Applications 폴더로 드래그하세요.

---

## 지원 문의

문제가 해결되지 않으면 다음을 통해 연락하세요:

- **GitHub Issues:** [https://github.com/nexu-io/nexu/issues](https://github.com/nexu-io/nexu/issues)
- **커뮤니티:** [문의하기](/ko/guide/contact)
