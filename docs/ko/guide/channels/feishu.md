# Feishu

App ID와 App Secret만 있으면 Feishu 봇을 nexu에 연결할 수 있습니다.

## 1단계: Feishu 앱 생성

1. [Feishu Open Platform](https://open.feishu.cn/app)에 접속하여 로그인하고 "Create Custom App"을 클릭합니다.

![Feishu Open Platform 앱 목록](/assets/feishu/step1-app-list.webp)

2. 앱 이름, 설명을 입력하고, 아이콘을 선택한 후 "Create"를 클릭합니다.

![Create Custom App](/assets/feishu/step1-create-app.webp)

3. "Credentials & Basic Info" 페이지에서 다음 두 값을 복사합니다:
   - **App ID**
   - **App Secret**

![App ID와 App Secret 가져오기](/assets/feishu/step1-credentials.webp)

## 2단계: nexu에 자격 증명 추가

nexu 클라이언트를 열고, Feishu 채널 설정에서 App ID와 App Secret을 입력한 후 "Connect"를 클릭합니다.

![nexu에서 자격 증명 추가](/assets/feishu/step3-nexu-connect.webp)

## 3단계: 앱 권한 가져오기

1. Feishu Open Platform에서 앱을 열고, 왼쪽 사이드바의 "Permission Management"를 클릭한 후 "Batch Import/Export"를 클릭합니다.

![Permission Management 페이지](/assets/feishu/step3-permission-management.webp)

2. 대화상자에서 "Import"를 선택하고, 다음 JSON을 붙여넣은 후 "Next, Confirm New Permissions"를 클릭합니다.

![권한 JSON 붙여넣기](/assets/feishu/step3-paste-json.webp)

::: details 클릭하여 권한 JSON 펼치기
```json
{
  "scopes": {
    "tenant": [
      "board:whiteboard:node:create",
      "board:whiteboard:node:delete",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "calendar:calendar.acl:create",
      "calendar:calendar.acl:delete",
      "calendar:calendar.acl:read",
      "calendar:calendar.event:create",
      "calendar:calendar.event:delete",
      "calendar:calendar.event:read",
      "calendar:calendar.event:reply",
      "calendar:calendar.event:update",
      "calendar:calendar.free_busy:read",
      "calendar:calendar:create",
      "calendar:calendar:delete",
      "calendar:calendar:read",
      "calendar:calendar:subscribe",
      "calendar:calendar:update",
      "cardkit:card:write",
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "docs:document.comment:create",
      "docs:document.comment:read",
      "docs:document.comment:update",
      "docs:document.comment:write_only",
      "docs:permission.member:create",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive.metadata:readonly",
      "drive:drive.search:readonly",
      "drive:drive:version",
      "drive:drive:version:readonly",
      "im:app_feed_card:write",
      "im:biz_entity_tag_relation:read",
      "im:biz_entity_tag_relation:write",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.announcement:read",
      "im:chat.announcement:write_only",
      "im:chat.chat_pins:read",
      "im:chat.chat_pins:write_only",
      "im:chat.collab_plugins:read",
      "im:chat.collab_plugins:write_only",
      "im:chat.managers:write_only",
      "im:chat.members:bot_access",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:chat.menu_tree:read",
      "im:chat.menu_tree:write_only",
      "im:chat.moderation:read",
      "im:chat.tabs:read",
      "im:chat.tabs:write_only",
      "im:chat.top_notice:write_only",
      "im:chat.widgets:read",
      "im:chat.widgets:write_only",
      "im:chat:create",
      "im:chat:delete",
      "im:chat:moderation:write_only",
      "im:chat:operate_as_owner",
      "im:chat:read",
      "im:chat:readonly",
      "im:chat:update",
      "im:datasync.feed_card.time_sensitive:write",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message.urgent",
      "im:message.urgent.status:write",
      "im:message.urgent:phone",
      "im:message.urgent:sms",
      "im:message:readonly",
      "im:message:recall",
      "im:message:send_as_bot",
      "im:message:send_multi_depts",
      "im:message:send_multi_users",
      "im:message:send_sys_msg",
      "im:message:update",
      "im:resource",
      "im:tag:read",
      "im:tag:write",
      "im:url_preview.update",
      "im:user_agent:read",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet.meta:write_only",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:write_only",
      "task:task:read",
      "task:task:write",
      "task:tasklist:read",
      "task:tasklist:write",
      "wiki:member:create",
      "wiki:member:retrieve",
      "wiki:member:update",
      "wiki:wiki:readonly"
    ],
    "user": [
      "board:whiteboard:node:create",
      "board:whiteboard:node:delete",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "calendar:calendar.acl:create",
      "calendar:calendar.acl:delete",
      "calendar:calendar.acl:read",
      "calendar:calendar.event:create",
      "calendar:calendar.event:delete",
      "calendar:calendar.event:read",
      "calendar:calendar.event:reply",
      "calendar:calendar.event:update",
      "calendar:calendar.free_busy:read",
      "calendar:calendar:create",
      "calendar:calendar:delete",
      "calendar:calendar:read",
      "calendar:calendar:subscribe",
      "calendar:calendar:update",
      "cardkit:card:write",
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "docs:document.comment:create",
      "docs:document.comment:read",
      "docs:document.comment:update",
      "docs:document.comment:write_only",
      "docs:permission.member:create",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive.metadata:readonly",
      "drive:drive.search:readonly",
      "drive:drive:version",
      "drive:drive:version:readonly",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.announcement:read",
      "im:chat.announcement:write_only",
      "im:chat.chat_pins:read",
      "im:chat.chat_pins:write_only",
      "im:chat.collab_plugins:read",
      "im:chat.collab_plugins:write_only",
      "im:chat.managers:write_only",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:chat.moderation:read",
      "im:chat.tabs:read",
      "im:chat.tabs:write_only",
      "im:chat.top_notice:write_only",
      "im:chat:delete",
      "im:chat:moderation:write_only",
      "im:chat:read",
      "im:chat:readonly",
      "im:chat:update",
      "im:message",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message.urgent.status:write",
      "im:message:readonly",
      "im:message:recall",
      "im:message:update",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet.meta:write_only",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:write_only",
      "task:task:read",
      "task:task:write",
      "task:tasklist:read",
      "task:tasklist:write",
      "wiki:member:create",
      "wiki:member:retrieve",
      "wiki:member:update",
      "wiki:wiki:readonly"
    ]
  }
}
```
:::

3. 가져온 권한(총 178개)을 검토하고 "Apply"를 클릭합니다.

![가져온 권한 확인](/assets/feishu/step3-confirm-permissions.webp)

4. 데이터 범위 확인 대화상자에서 "Confirm"을 클릭하여 가져오기를 완료합니다.

![데이터 범위 확인](/assets/feishu/step3-data-scope.webp)

이 권한은 메시징, 문서 읽기/쓰기, 캘린더 관리, 스프레드시트 작업 등을 포함하며 — 모든 nexu Agent Skills가 올바르게 작동하도록 보장합니다.

## 4단계: 이벤트 및 콜백 설정

### 이벤트 설정

1. Feishu Open Platform에서 앱을 열고, 왼쪽 사이드바의 "Events & Callbacks"를 클릭한 후 "Event Configuration" 탭을 엽니다.

![Events & Callbacks 페이지](/assets/feishu/step4-event-config.webp)

2. "Subscription Method" 옆의 편집 버튼을 클릭하고, "Use Long Connection to Receive Events"를 선택한 후 "Save"를 클릭합니다.

![이벤트용 Long Connection 선택](/assets/feishu/step4-event-websocket.webp)

3. "Add Event"를 클릭합니다.

![Add Event 버튼](/assets/feishu/step4-add-event.webp)

4. 대화상자에서 다음 이벤트를 검색하여 선택한 후 "Add"를 클릭합니다:
   - **First conversation created between user and bot** (`p2p_chat_create`)
   - **Receive message** (`im.message.receive_v1`)
   - **Bot added to group** (`im.chat.member.bot.added_v1`)
   - **User enters bot conversation** (`im.chat.access_event.bot_p2p_chat_entered_v1`)

![이벤트 선택](/assets/feishu/step4-select-event.webp)

5. 추가 후 "Added Events" 목록에서 이벤트를 확인합니다.

![추가된 이벤트 목록](/assets/feishu/step4-event-list.webp)

### 콜백 설정

1. "Callback Configuration" 탭으로 전환하고 "Subscription Method" 옆의 편집 버튼을 클릭합니다.

![Callback Configuration 페이지](/assets/feishu/step4-callback-tab.webp)

2. "Use Long Connection to Receive Callbacks"를 선택하고 "Save"를 클릭합니다.

![콜백용 Long Connection 선택](/assets/feishu/step4-callback-websocket.webp)

3. "Add Callback"을 클릭합니다.

![Add Callback 버튼](/assets/feishu/step4-add-callback.webp)

4. 대화상자에서 "Card" 카테고리를 선택하고, "Card Action Trigger" (`card.action.trigger`)를 체크한 후 "Add"를 클릭합니다.

![Card Action Trigger 선택](/assets/feishu/step4-select-callback.webp)

## 5단계: 게시 및 테스트

1. Feishu Open Platform으로 돌아가서 "Version Management & Release"로 이동합니다.

![Version Management & Release](/assets/feishu/step4-version-manage.webp)

2. "Create Version"을 클릭하고, 버전 번호와 릴리스 노트를 입력한 후 "Save"를 클릭합니다.

![Create Version](/assets/feishu/step4-create-version.webp)

3. "Publish"를 클릭하고 승인을 기다립니다.

![Publish](/assets/feishu/step4-publish.webp)

4. 승인되면 nexu 클라이언트에서 "Chat"을 클릭하여 Feishu로 이동하고 봇과 채팅하세요 🎉

![Feishu 연결됨](/assets/feishu/step3-connected.webp)

## FAQ

**Q: 공개 서버가 필요한가요?**

아니요. nexu는 Feishu의 Long Connection(WebSocket) 모드를 사용합니다 — 공개 IP나 콜백 URL 불필요.

**Q: 왜 이렇게 많은 권한이 필요한가요?**

이 권한은 다양한 nexu Agent Skills(메시징, 문서, 캘린더, 스프레드시트 등)에 해당합니다. 기본 채팅만 필요하면 `im:` 스코프만 활성화할 수 있습니다.
