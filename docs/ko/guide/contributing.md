# nexu에 기여하기

이 페이지는 nexu에 기여하기 위한 한국어 진입점입니다.

## 기본 소스

영문 기여 가이드 원본은 저장소 루트에 있습니다:

- [CONTRIBUTING.md](https://github.com/nexu-io/nexu/blob/main/CONTRIBUTING.md)

영문 기여 가이드를 업데이트하려면 해당 파일을 먼저 수정하세요.

## 관련 페이지

- 중국어 번역: [中文贡献指南](/zh/guide/contributing)
- GitHub Issues: [github.com/nexu-io/nexu/issues](https://github.com/nexu-io/nexu/issues)
- GitHub Discussions: [github.com/nexu-io/nexu/discussions](https://github.com/nexu-io/nexu/discussions)

## 빠른 참고

- 대규모 변경을 시작하기 전에 기존 이슈와 토론을 검색하세요.
- Pull Request는 작고 집중적으로 유지하세요.
- API 키나 토큰 같은 비밀 정보를 절대 커밋하지 마세요.
- 여러 언어로 존재하는 가이드를 업데이트할 때, 가능하면 번역본도 동기화하세요.

## 로컬 문서 워크플로

문서 사이트를 로컬에서 미리보기:

```bash
cd docs
pnpm install
pnpm dev
```

새 문서 페이지를 추가할 때:

- 영문 페이지는 `docs/en/`에
- 중문 페이지는 `docs/zh/`에
- 한국어 페이지는 `docs/ko/`에
- `docs/.vitepress/config.ts`에서 사이드바 항목 업데이트
- 모든 이미지가 `/assets/...`에서 올바르게 로드되는지 확인
