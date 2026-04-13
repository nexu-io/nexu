# Seedance 2.0 동영상 생성

Seedance 2.0을 사용해 보고 싶으신가요? 아래 단계를 따라하면 `nexu`에서 직접 동영상을 생성할 수 있습니다.

## 시작하기 전에

시작하기 전에 다음을 확인하세요:

- nexu 클라이언트가 설치되어 있어야 합니다
- 로그인할 수 있는 nexu 계정이 있어야 합니다
- `nexu`와 채팅할 수 있는 IM 채널이 하나 설정되어 있어야 합니다

클라이언트를 아직 설치하지 않았다면 [nexu 웹사이트](https://nexu.io/)나 [GitHub 저장소](https://github.com/nexu-io/nexu)에서 자세한 정보를 확인한 후, [다운로드 페이지](https://nexu.io/download)에서 최신 버전을 다운로드하세요.

## 1단계: Seedance 2.0 체험 키 신청

클라이언트 홈 페이지에서 **Seedance 2.0** 배너를 찾아 클릭하여 신청 절차를 시작하세요.

![홈 페이지의 Seedance 2.0 배너](/assets/seedance/home-banner.webp)

다음을 수행해야 합니다:

1. GitHub에서 `nexu` 저장소에 Star
2. 그룹에 참여하고, 고정 메시지를 확인하여 폼 링크를 열고 정보를 제출
3. 심사 대기

![체험 키 신청: GitHub에서 nexu에 Star](/assets/seedance/apply-key-step1-star.webp)

**GitHub Star 스크린샷 요구사항 (심사 필수)**: 신청서를 제출할 때 **저장소 이름**, **Star 상태** (예: 저장소에 Star를 했다는 표시), **로그인된 GitHub 계정**이 명확하게 보이는 저장소 페이지 스크린샷을 포함하세요. **이 모든 항목이 필수**이며, 누락되면 승인에 영향을 줄 수 있습니다. 아래 예시를 참조하세요:

![심사 요구사항을 충족하는 GitHub Star 스크린샷 예시](/assets/seedance/github-star-review-example.webp)

승인 후, 폼에 입력한 이메일 주소로 체험 키가 발송됩니다.

저장소에 Star를 한 후, 팝업의 버튼을 클릭하여 그룹에 참여하세요.

![체험 키 신청: 버튼을 클릭하여 그룹 참여](/assets/seedance/apply-key-step2-join-group.webp)

그룹에 들어가면 고정 메시지를 확인하고, 폼 링크를 열어 정보를 제출하세요.

## 2단계: IM 채널을 먼저 설정

IM 채널을 먼저 설정하는 것을 권장합니다. 그러면 키가 도착하자마자 `nexu`에 보내 활성화할 수 있습니다.

가장 많이 사용하는 채널을 선택하고 화면의 단계를 따르세요. 자세한 내용은 [채널 설정](/ko/guide/channels)을 참조하세요.

![IM 채널 설정 및 채팅 시작](/assets/seedance/im-channel-config.webp)

## 3단계: `nexu`에 키 전송

`nexu`는 현재 `Libtv skill`을 통해 Seedance 2.0에 접근합니다. 키를 받으면 설정된 IM 채팅에서 다음과 같이 전송하세요:

> This is the Libtv skill key provided by nexu official: `<your-key>`

키는 공식 체험 키 또는 자체 Libtv Access Key일 수 있습니다.

![nexu에 Libtv 스킬 키 전송](/assets/seedance/libtv-skill-key.webp)

이메일을 받으면 Seedance 2.0 체험 키를 복사하여 이전에 설정한 IM 대화에서 전송하세요.

활성화에 성공하면 동영상 생성을 시작할 수 있습니다.

## 4단계: 첫 번째 동영상 생성

활성화 후 `nexu`에 동영상 생성 요청을 보내기만 하면 됩니다.

다음 텍스트를 프롬프트로 직접 사용할 수 있습니다:

> **Use the Seedance 2.0 model in the Libtv skill** to generate a breathtaking youth anime short film: on a midsummer evening, the sky glows with a dreamy orange-pink and blue gradient, and a gentle breeze lifts the school uniforms and hair of a teenage boy and girl as they run side by side between a sunset-washed school rooftop and seaside streets. The scene should feel full of youthful emotion, freedom, and heart-racing romance. Start with a close-up of their eyes, capturing bright pupils, flushed cheeks, and subtle breathing, then transition into smooth tracking shots, circular camera movement, slow-motion running, and upward shots of the sky and birds. Include drifting flower petals, floating sunlight particles, lens flares, moving tree shadows, city neon, and summer festival lights. The overall style should be a high-quality Japanese anime film with clean delicate linework, transparent and saturated color, dreamy lighting, natural character motion, and sincere emotion, filled with youth, romance, intensity, and hope. Use cinematic composition, ultra-high detail, strong atmosphere, fluid animation, elegant transitions, and striking visuals.

![Seedance 2.0 동영상 생성 작업](/assets/seedance/generate-video-anime-prompt.webp)

공식 체험 크레딧 2회를 사용하는 경우, 동영상 생성 중에 캔버스 링크를 받을 수 있습니다. 이 링크는 nexu 공식 Libtv 캔버스를 가리키며, 접근할 수 없으므로 무시하셔도 됩니다.

## 프롬프트 작성 팁

더 안정적이고 예측 가능한 결과를 원한다면 프롬프트에 다음 요소를 포함하세요:

1. 주체
2. 동작
3. 장면
4. 스타일
5. 카메라 언어
6. 길이

간단한 요청에서 시작하여 더 풍부한 프롬프트로 확장할 수도 있습니다. 예를 들어, "키스 동영상 생성"을 "일몰 해변에서 키스하는 두 만화 캐릭터, 과장된 표정, 느린 푸시인 샷, 5초"로 바꿀 수 있습니다.

## FAQ

**Q: 폼을 제출한 후 키를 받는 데 얼마나 걸리나요?**

보통 약 2시간 정도 걸립니다. 승인되면 폼에 입력한 이메일 주소로 키가 발송됩니다.

**Q: IM 채널을 먼저 설정해야 하나요?**

네. 키를 사용하려면 `nexu`에 보내야 하므로, IM 채널을 먼저 설정하면 과정이 더 원활합니다.

**Q: 공식 체험 키는 몇 번 사용할 수 있나요? 반환된 캔버스 링크를 열 수 없는 이유는?**

`nexu`는 `Libtv skill`을 통해 Seedance 2.0에 접근합니다. GitHub 저장소에 Star를 한 후, 공식 체험에는 보통 2회의 동영상 생성이 포함됩니다. 반환된 캔버스 링크는 nexu 공식 Libtv 캔버스를 가리키며, 사용자 계정으로는 접근할 수 없으므로 무시하셔도 됩니다.

**Q: 자체 Libtv Access Key를 받고 캔버스에서 결과를 보려면 어떻게 하나요?**

[LibTV 웹사이트](https://www.liblib.tv/)에 접속하여 계정으로 로그인하세요. Access Key는 보통 오른쪽 상단 아바타 근처에서 확인할 수 있습니다. 자체 Access Key를 `nexu`에 보낸 후, 반환된 캔버스 링크를 열어 Libtv 캔버스에서 결과를 확인할 수 있습니다.

## 아직 궁금한 점이 있으신가요?

다른 질문이 있거나 최신 지원이 필요하시면:

[![문의하기](/assets/seedance/contact-us.webp)](/ko/guide/contact)
