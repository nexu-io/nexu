# モデル設定

Nexu は2つのモデル統合パスをサポートしています：**Nexu Official**（管理モデル、サインインしてすぐ利用）と **BYOK**（Bring Your Own Key）。既存の会話やチャンネル接続に影響を与えず、いつでも切り替えられます。

## ステップ 1：設定を開く

Nexu クライアントの左サイドバーで**設定**をクリックし、AI モデルプロバイダー設定ページを開きます。

![Open Settings page](/assets/nexu-settings-open.webp)

## ステップ 2：統合モードを選ぶ

### オプション A — Nexu Official（推奨）

左のプロバイダー一覧から **Nexu Official** を選び、**Nexu にサインイン**をクリックして認証します。

サインイン後は API キーは不要です。Claude Sonnet 4.6、Claude Opus 4.6、Claude Haiku 4.5 などのモデルがすぐに利用できます。

![Nexu Official model configuration](/assets/nexu-models-official.webp)

### オプション B — Bring Your Own Key（BYOK）

一覧から **Anthropic**、**OpenAI**、**Google AI**、またはその他のプロバイダーを選びます：

1. **API Key** 欄にキーを貼り付けます。
2. カスタムプロキシが必要な場合は **API Proxy URL** を変更します。
3. **保存**をクリックします。Nexu がキーを自動検証し、利用可能なモデル一覧を読み込みます。

![BYOK configuration](/assets/nexu-models-byok.webp)

## ステップ 3：有効なモデルを選択

接続に成功したら、設定ページ上部の **Nexu Bot Model** ドロップダウンで、エージェントが使うモデルを選びます。プロバイダー間の切り替えもいつでも可能です。

![Select active model](/assets/nexu-model-select.webp)

## 対応プロバイダー

| プロバイダー | デフォルトのベース URL | キーの形式 |
| --- | --- | --- |
| Anthropic | `https://api.anthropic.com` | `sk-ant-...` |
| OpenAI | `https://api.openai.com/v1` | `sk-...` |
| Google AI | `https://generativelanguage.googleapis.com/v1beta` | `AIza...` |
| xAI | `https://api.x.ai/v1` | `xai-...` |
| Custom | OpenAI 互換エンドポイント | プロバイダー依存 |

## ベストプラクティス

- 不要なアクセス範囲を減らすため、最小権限の API キーを使います。
- スクリーンショット、サポートチケット、Git 履歴にキーを載せないでください。
- BYOK プロバイダーを追加する際は、保存前に**接続を検証**で疎通を確認してください。
- プロキシ、セルフホストゲートウェイ、OpenAI 互換推論サービスが必要な場合は **Custom** プロバイダー型を使います。

## FAQ

**Q: 最初はどちらのモードがよいですか？**

Nexu Official を推奨します。サインインするだけで、設定なしに高品質モデルが使えます。

**Q: 複数の BYOK プロバイダーを同時に設定できますか？**

はい。Anthropic、OpenAI、Google AI などは独立して設定できます。**Nexu Bot Model** ドロップダウンからいつでも切り替えられます。

**Q: API キーは Nexu のサーバーにアップロードされますか？**

いいえ。API キーはローカル端末にのみ保存され、Nexu のサーバーには送信されません。
