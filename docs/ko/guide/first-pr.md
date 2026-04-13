# Good First Issue 기여자 가이드

**nexu**를 사용해 본 적이 있거나, 「IM + 데스크톱 클라이언트 + 디지털 클론」과 같은 제품에 관심이 있다면, **Good First Issue**로 첫 PR을 시작해 보세요.

**Good First Issue 기여자**를 지속적으로 모집하고 있습니다.

메인테이너가 이미 범위를 정리해 놓은 작은 작업입니다. 범위가 명확하고, 방향이 집중되어 있어 처음 오픈소스에 참여하는 분에게 적합합니다.

## 왜 첫 참여에 적합한가요

- **시작하기 쉬움**: 보통 한 가지 방향만 관련됩니다. 전체 아키텍처를 이해할 필요가 없습니다.
- **검증하기 쉬움**: 범위가 작고 수락 기준이 명확하여 직접 테스트할 수 있습니다.
- **피드백이 빠름**: 이런 유형의 이슈는 리뷰가 빠르게 진행됩니다.

## 이런 분에게 추천합니다

다음 중 하나에 해당한다면 `good-first-issue`부터 시작하는 것을 추천합니다:

- 오픈소스 기여가 처음
- UX, 문서, i18n, 프론트엔드 인터랙션에 관심이 있음
- 작은 작업부터 시작하여 프로젝트에 익숙해지고 싶음
- 리뷰어와 함께 수정을 완성할 의향이 있음

바로 확인하기:

- [Good First Issue 목록](https://github.com/nexu-io/nexu/labels/good-first-issue)
- [GitHub Issues](https://github.com/nexu-io/nexu/issues)
- [기여 가이드](/ko/guide/contributing)

## 기여 후 얻을 수 있는 것

기여가 머지되면 "PR 머지 완료"로 끝나지 않습니다:

- 기여는 공개 전시 및 리더보드에 반영
- 노력은 규칙에 따라 포인트로 기록
- 첫 기여자는 후속 참여 제안을 받음

자세한 규칙:

- [기여자 보상 및 지원](/ko/guide/contributor-rewards)

## 3단계: 관찰자에서 기여자로

### 1. 이슈 선택

[Good First Issue 목록](https://github.com/nexu-io/nexu/labels/good-first-issue)을 열고, 관심 있는 이슈를 선택한 후, 이슈에 댓글을 남겨 담당을 선언하세요.

추천하는 첫 작업:

- 카피 / i18n 수정
- 소규모 UI / 인터랙션 문제
- 문서 보완
- 재현이 명확하고 검증하기 쉬운 작은 버그

### 2. 가이드 읽기 & 환경 설정

코딩을 시작하기 전에 [기여 가이드](/ko/guide/contributing)를 읽어보세요.

최소 설정:

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
```

코드를 변경하는 경우 최소한 다음을 실행:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

문서를 변경하는 경우 로컬 미리보기:

```bash
cd docs
pnpm install
pnpm dev
```

### 3. PR 제출

저장소를 Fork하고, 명확한 브랜치 이름을 만들고, PR 설명에 다음을 포함:

- 관련 Issue 번호
- 무엇을 변경했는지
- 어떻게 검증하는지
- UI 변경인 경우 스크린샷 또는 녹화

머지 후, 감사 및 포인트 기록 프로세스에 진입합니다.

## nexu Discord 기여자 교류 그룹 참여 💬

혼자 연구하는 것보다 함께 이야기하는 것이 낫습니다. 그룹에는 메인테이너와 경험 많은 기여자가 있습니다. 참여해서 첫 기여에 대해 이야기해 보세요 👇

👉 [nexu Discord 참여](https://discord.gg/vMrySTJW8u)

## FAQ

### 시니어 엔지니어가 아니어도 괜찮나요?

물론입니다. Good First Issue는 첫 기여자를 위한 진입점입니다.

### 영어를 잘 못해도 괜찮나요?

Issue / PR은 중국어와 영어 모두 팀이 확인합니다. 먼저 기여 가이드를 읽어보세요. 언어는 장벽이 아닙니다, 시작하는 것이 중요합니다.

### AI를 사용해서 코드를 작성해도 되나요?

네. PR에서 AI 도구를 사용했는지와 직접 검증한 내용을 간단히 설명하는 것을 권장합니다.

### PR을 제출하면 무시되지 않나요?

공개 일정에 따라 리뷰합니다. Good First Issue PR은 보통 더 빠른 피드백을 받지만, 메인테이너 상황에 따라 다릅니다.

## 마지막으로

오픈소스의 가장 흥미로운 점은 여러분의 변경 사항이 버전 히스토리에 남고, 실제로 사용자에게 사용된다는 것입니다.

준비가 되었다면 [Good First Issue](https://github.com/nexu-io/nexu/labels/good-first-issue)부터 시작하세요.
