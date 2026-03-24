# Slack

Slack ボットを nexu に接続するには、**Signing Secret** と **Bot Token** が必要です。

## ステップ 1：Slack アプリを作成

1. 次のリンクから、マニフェストを使って事前設定済みの Slack アプリを作成します（権限、イベント、ボット設定が自動で構成されます）。

👉 [Slack アプリを作成](https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22Nexu%22%2C%22description%22%3A%22Nexu%20%E2%80%94%20AI-powered%20workspace%20for%20your%20team%22%2C%22background_color%22%3A%22%2329292b%22%7D%2C%22features%22%3A%7B%22bot_user%22%3A%7B%22display_name%22%3A%22Nexu%22%2C%22always_online%22%3Atrue%7D%7D%2C%22oauth_config%22%3A%7B%22redirect_urls%22%3A%5B%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Foauth%2Fslack%2Fcallback%22%5D%2C%22scopes%22%3A%7B%22bot%22%3A%5B%22app_mentions%3Aread%22%2C%22assistant%3Awrite%22%2C%22channels%3Ahistory%22%2C%22channels%3Aread%22%2C%22chat%3Awrite%22%2C%22chat%3Awrite.customize%22%2C%22chat%3Awrite.public%22%2C%22files%3Aread%22%2C%22files%3Awrite%22%2C%22groups%3Ahistory%22%2C%22groups%3Aread%22%2C%22im%3Ahistory%22%2C%22im%3Aread%22%2C%22im%3Awrite%22%2C%22im%3Awrite.topic%22%2C%22links%3Awrite%22%2C%22metadata.message%3Aread%22%2C%22mpim%3Ahistory%22%2C%22mpim%3Aread%22%2C%22mpim%3Awrite%22%2C%22mpim%3Awrite.topic%22%2C%22reactions%3Awrite%22%2C%22remote_files%3Aread%22%2C%22team%3Aread%22%2C%22usergroups%3Aread%22%2C%22users%3Aread%22%2C%22users.profile%3Aread%22%5D%7D%7D%2C%22settings%22%3A%7B%22event_subscriptions%22%3A%7B%22request_url%22%3A%22https%3A%2F%2Fapi.nexu.io%2Fapi%2Fslack%2Fevents%22%2C%22bot_events%22%3A%5B%22app_mention%22%2C%22app_uninstalled%22%2C%22file_created%22%2C%22message.channels%22%2C%22message.groups%22%2C%22message.im%22%2C%22message.mpim%22%2C%22subteam_created%22%2C%22team_join%22%2C%22team_rename%22%2C%22tokens_revoked%22%5D%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Afalse%2C%22token_rotation_enabled%22%3Afalse%7D%7D)

2. インストール先のワークスペースを選び、「次へ」をクリックします。
![Pick a Workspace](/assets/slack/step1-pick-workspace.webp)

3. 事前設定された権限と URL を確認し、「作成」をクリックします。
![Review and Create](/assets/slack/step1-review-create.webp)

4. 作成後、「了解」をクリックします。
![App Created](/assets/slack/step1-welcome.webp)

## ステップ 2：Signing Secret を取得

「基本情報」→「App 認証情報」に移動し、**Signing Secret** をコピーします。
![Get Signing Secret](/assets/slack/step2-signing-secret.webp)

## ステップ 3：Bot Token を取得

1. サイドバーから「アプリをインストール」を開き、「ワークスペースにインストール」をクリックします。
![Install App](/assets/slack/step3-install-app.webp)

2. 認可画面で「許可」をクリックします。
![Authorize App](/assets/slack/step3-authorize.webp)

3. **Bot User OAuth Token** をコピーして保存します。
![Get Bot Token](/assets/slack/step3-bot-token.webp)

## ステップ 4：ダイレクトメッセージを有効化

サイドバーから「App Home」に移動し、下にスクロールして「タブを表示」→「メッセージタブ」が有効になっていることを確認し、「メッセージタブからスラッシュコマンドとメッセージの送信をユーザーに許可する」にチェックを入れます。
![Enable Direct Messages](/assets/slack/step4-app-home.webp)

## ステップ 5：nexu に認証情報を追加

nexu クライアントを開き、Slack チャンネル設定に Bot User OAuth Token と Signing Secret を入力し、「接続」をクリックします。
![Add credentials in nexu](/assets/slack/step5-nexu-connect.webp)

接続後、「チャット」をクリックして Slack に移動し、ボットと会話を始めます 🎉
![Slack connected](/assets/slack/step5-connected.webp)

## FAQ

**Q: 権限を手動で設定する必要がありますか？**

いいえ。上記のリンクで作成されたアプリには、すべての権限とイベントサブスクリプションが事前設定されています。

**Q: パブリックサーバーは必要ですか？**

いいえ。nexu がイベント受信を自動的に処理するため、コールバック URL の設定は不要です。
