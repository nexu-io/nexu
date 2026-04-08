# QQ

QQ ボットを nexu に接続するには、**App ID** と **App Secret** だけで十分です。

## ステップ 1：nexu で QQ チャンネルを開く

1. nexu クライアントを開き、Channels セクションで **QQ** をクリックします。

![Choose QQ in nexu](/assets/qq/step3-choose-qq-channel.webp)

2. QQ オープンプラットフォームを開きます：https://q.qq.com/qqbot/openclaw/login.html

![Open the QQ platform from nexu](/assets/qq/step3-open-platform-link.webp)

## ステップ 2：QQ オープンプラットフォームにログイン

1. モバイル版 QQ でログイン QR コードをスキャンします。

![QQ Open Platform login QR](/assets/qq/step1-login-qr.webp)

2. モバイル版 QQ で「同意」をタップして、開発者ログインを完了します。

![Confirm login in mobile QQ](/assets/qq/step1-login-confirm.webp)

## ステップ 3：QQ ボットを作成

1. ログイン後、ボット一覧で「Create Bot」をクリックします。

![Create a QQ bot](/assets/qq/step1-create-bot.webp)

## ステップ 4：App ID と App Secret をコピー

![Bot detail entry](/assets/qq/step2-create-bot.webp)

ボット詳細ページで次の 2 つの値をコピーして保存します。

- **App ID**
- **App Secret**

App Secret 全体が表示されるのは一度だけの場合があるため、すぐに保存してください。

## ステップ 5：nexu で QQ を接続

nexu の QQ チャンネルダイアログに App ID と App Secret を貼り付け、「Connect QQ」をクリックします。

![Connect QQ in nexu](/assets/qq/step3-nexu-connect.webp)

## ステップ 6：QQ で会話を始める

接続が完了したら、デスクトップ版 QQ またはモバイル版 QQ を開き、作成したボットとの会話を見つけてメッセージを送ります。

![Chat with the Agent in QQ](/assets/qq/step4-chat.webp)

---

## FAQ

**Q: 自分でサーバーや公開 Callback URL を用意する必要がありますか？**

いいえ。現在の nexu の QQ 連携では、クライアントに App ID と App Secret を入力するだけで接続できます。

**Q: 接続後、この QQ ボットはどこで見つけられますか？**

デスクトップ版 QQ またはモバイル版 QQ を開き、作成時に設定したボット名で検索するか、最近の会話一覧を確認してください。

**Q: 接続成功と表示されているのに、なぜボットが返信しないのですか？**

まず次の点を確認してください。

- App ID と App Secret が正しく入力されているか
- nexu クライアントがまだ起動しているか
- メッセージを送っている相手が、今作成したそのボットか

**Q: パソコンの電源を切っても QQ ボットは返信し続けますか？**

nexu クライアントを起動したままにする必要があります。nexu がバックグラウンドで動作し、パソコンがスリープしていなければ返信を続けられます。

**Q: QQ グループにこのボットを追加できますか？**

はい。QQ グループに追加して使えます。まずは 1 対 1 の会話で正常に動くことを確認するのがおすすめです。
