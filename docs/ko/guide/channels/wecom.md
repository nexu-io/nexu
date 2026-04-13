# WeCom

WeCom 클라이언트의 지능형 봇 기능을 사용하여 `Bot ID`와 `Secret`만 복사하면 WeCom을 nexu에 연결할 수 있습니다.

## 사전 요구사항

- 이미 WeCom 조직의 구성원이라면, 지능형 봇을 생성하고 사용하려면 해당 조직의 기업 관리자 권한이 필요합니다.
- 개인 사용자라면 먼저 자체 WeCom 계정을 등록할 수 있습니다. 개인 등록은 무료이며 사업자 자격이 필요하지 않습니다.

## 1단계: 지능형 봇 열기 및 생성 시작

1. nexu 클라이언트를 열고 채널 섹션에서 **WeCom**을 클릭합니다.

![nexu에서 WeCom 선택](/assets/wecom/step0-choose-wecom-channel.webp)

2. WeCom 클라이언트에서 왼쪽 사이드바의 "Workbench"를 클릭하고, 상단에서 "Smart Office"로 전환한 후, "Intelligent Bot"을 엽니다.

![지능형 봇 페이지 열기](/assets/wecom/step1-open-workbench.webp)

3. 지능형 봇 페이지에서 "Create Bot"을 클릭합니다.

![Create Bot 클릭](/assets/wecom/step2-create-bot-entry.webp)

4. 생성 대화상자에서 왼쪽 하단의 "Manual Create"를 클릭합니다.

![Manual Create 선택](/assets/wecom/step3-manual-create.webp)

## 2단계: API 모드로 전환 및 자격 증명 복사

1. 생성 페이지에서 오른쪽의 "Create in API Mode"를 클릭합니다.

![API 모드로 전환](/assets/wecom/step4-api-mode.webp)

2. API 설정에서 "Use Long Connection"을 선택합니다.

3. 다음 두 값을 복사하고 저장합니다:
   - **Bot ID**
   - **Secret**

nexu에서 WeCom을 연결할 때 이 값들이 필요합니다.

![Long Connection 선택 및 Bot ID, Secret 복사](/assets/wecom/step5-copy-botid-secret.webp)

## 3단계: 권한 부여

1. 같은 페이지에서 아래로 스크롤하여 "Available Permissions"를 찾고 오른쪽의 확장 버튼을 클릭합니다.

![권한 패널 열기](/assets/wecom/step6-open-permissions.webp)

2. 권한 대화상자에서 "Authorize All"을 클릭합니다.

![모든 권한 부여](/assets/wecom/step7-authorize-all.webp)

## 4단계: 봇 설정 완료 및 저장

1. 봇 설정 페이지에서 가시 범위를 확인하거나 조정하여 사용자 또는 의도된 구성원이 봇을 보고 사용할 수 있도록 합니다.

![가시 범위 설정](/assets/wecom/step8-visible-range.webp)

2. 필요하면 봇 아바타, 이름, 설명을 편집한 후 "Confirm"을 클릭합니다.

![봇 정보 편집](/assets/wecom/step9-edit-bot-info.webp)

3. 설정을 확인한 후 하단의 "Save"를 클릭합니다.

![봇 설정 저장](/assets/wecom/step10-save-bot.webp)

## 5단계: 봇 열기 및 사용 시작

1. 저장 후, 봇 상세 페이지에서 "Use Now"를 클릭합니다.

![봇 상세 페이지 열기](/assets/wecom/step11-use-bot.webp)

2. nexu로 돌아가서 `Bot ID`와 `Secret`을 WeCom 채널 대화상자에 붙여넣고 "Connect WeCom"을 클릭합니다.

![nexu에서 Bot ID와 Secret 입력](/assets/wecom/step12-nexu-connect.webp)

3. 연락처 또는 봇 목록에서 방금 생성한 봇을 찾아 "Send Message"를 클릭합니다.

![봇 대화 열기](/assets/wecom/step12-send-message.webp)

4. 연결되면 WeCom에서 Agent와 이렇게 채팅할 수 있습니다.

![WeCom에서 봇과 채팅](/assets/wecom/step13-chat.webp)

---

## FAQ

**Q: 기업 관리자가 아니어도 사용할 수 있나요?**

네. 기존 조직의 관리자가 아니라면 먼저 자체 WeCom 계정을 등록하고 직접 지능형 봇을 생성할 수 있습니다.

**Q: 자체 서버나 공개 콜백 URL이 필요한가요?**

아니요. 이 흐름에서 "Use Long Connection"을 선택하면 자체 공개 콜백 주소를 설정할 필요가 없습니다.

**Q: 연결 후 봇이 응답하지 않는 이유는?**

먼저 다음을 확인하세요:

- nexu의 `Bot ID`와 `Secret`이 정확한지
- WeCom에서 권한이 부여되었는지
- 가시 범위에 본인이 포함되었는지
- nexu 클라이언트가 여전히 실행 중인지

**Q: 이 봇을 그룹 채팅에 추가할 수 있나요?**

네. 먼저 1:1 채팅에서 봇이 작동하는지 확인한 후 WeCom 그룹 채팅에 추가하는 것이 좋습니다.
