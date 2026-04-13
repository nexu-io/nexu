# Slack

Signing Secret과 Bot Token만 있으면 Slack 봇을 nexu에 연결할 수 있습니다.

## 1단계: Slack 앱 생성

1. 아래 링크를 클릭하여 매니페스트를 사용하여 사전 구성된 Slack 앱을 생성합니다 (권한, 이벤트, 봇 설정이 모두 자동으로 설정됨):

👉 [Create Slack App](https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22Nexu%22%2C%22description%22%3A%22Nexu%20%E2%80%94%20AI-powered%20workspace%20for%20your%20team%22%2C%22background_color%22%3A%22%2329292b%22%7D%2C%22features%22%3A%7B%22bot_user%22%3A%7B%22display_name%22%3A%22Nexu%22%2C%22always_online%22%3Atrue%7D%7D%2C%22oauth_config%22%3A%7B%22redirect_urls%22%3A%5B%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Foauth%2Fslack%2Fcallback%22%5D%2C%22scopes%22%3A%7B%22bot%22%3A%5B%22app_mentions%3Aread%22%2C%22assistant%3Awrite%22%2C%22channels%3Ahistory%22%2C%22channels%3Aread%22%2C%22chat%3Awrite%22%2C%22chat%3Awrite.customize%22%2C%22chat%3Awrite.public%22%2C%22files%3Aread%22%2C%22files%3Awrite%22%2C%22groups%3Ahistory%22%2C%22groups%3Aread%22%2C%22im%3Ahistory%22%2C%22im%3Aread%22%2C%22im%3Awrite%22%2C%22im%3Awrite.topic%22%2C%22links%3Awrite%22%2C%22metadata.message%3Aread%22%2C%22mpim%3Ahistory%22%2C%22mpim%3Aread%22%2C%22mpim%3Awrite%22%2C%22mpim%3Awrite.topic%22%2C%22reactions%3Awrite%22%2C%22remote_files%3Aread%22%2C%22team%3Aread%22%2C%22usergroups%3Aread%22%2C%22users%3Aread%22%2C%22users.profile%3Aread%22%5D%7D%7D%2C%22settings%22%3A%7B%22event_subscriptions%22%3A%7B%22request_url%22%3A%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Fslack%2Fevents%22%2C%22bot_events%22%3A%5B%22app_mention%22%2C%22app_uninstalled%22%2C%22file_created%22%2C%22message.channels%22%2C%22message.groups%22%2C%22message.im%22%2C%22message.mpim%22%2C%22subteam_created%22%2C%22team_join%22%2C%22team_rename%22%2C%22tokens_revoked%22%5D%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Afalse%2C%22token_rotation_enabled%22%3Afalse%7D%7D)

2. 설치할 Workspace를 선택하고 "Next"를 클릭합니다.

![Workspace 선택](/assets/slack/step1-pick-workspace.webp)

3. 사전 구성된 권한과 URL을 검토한 후 "Create"를 클릭합니다.

![검토 및 생성](/assets/slack/step1-review-create.webp)

4. 생성이 완료되면 "Got It"을 클릭합니다.

![앱 생성됨](/assets/slack/step1-welcome.webp)

## 2단계: Signing Secret 가져오기

"Basic Information" → "App Credentials"로 이동하여 복사합니다:
- **Signing Secret**

![Signing Secret 가져오기](/assets/slack/step2-signing-secret.webp)

## 3단계: Bot Token 가져오기

1. 사이드바에서 "Install App"으로 이동하고 "Install to Workspace"를 클릭합니다.

![Install App](/assets/slack/step3-install-app.webp)

2. 인증 페이지에서 "Allow"를 클릭합니다.

![앱 인증](/assets/slack/step3-authorize.webp)

3. 다음을 복사하고 저장합니다:
   - **Bot User OAuth Token**

![Bot Token 가져오기](/assets/slack/step3-bot-token.webp)

## 4단계: 다이렉트 메시지 활성화

사이드바에서 "App Home"으로 이동하고, 아래로 스크롤하여 "Show Tabs" → "Messages Tab"이 활성화되어 있는지 확인하고, "Allow users to send Slash commands and messages from the messages tab"을 체크합니다.

![다이렉트 메시지 활성화](/assets/slack/step4-app-home.webp)

## 5단계: nexu에 자격 증명 추가

nexu 클라이언트를 열고, Slack 채널 설정에서 Bot User OAuth Token과 Signing Secret을 입력한 후 "Connect"를 클릭합니다.

![nexu에서 자격 증명 추가](/assets/slack/step5-nexu-connect.webp)

연결되면 "Chat"을 클릭하여 Slack으로 이동하고 봇과 채팅하세요 🎉

![Slack 연결됨](/assets/slack/step5-connected.webp)

## FAQ

**Q: 권한을 수동으로 설정해야 하나요?**

아니요. 위 링크를 통해 생성된 앱은 모든 권한과 이벤트 구독이 사전 구성되어 있습니다.

**Q: 공개 서버가 필요한가요?**

아니요. nexu가 이벤트 수신을 자동으로 처리합니다 — 콜백 URL 설정 불필요.
