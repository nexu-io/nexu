<p align="center">
  <img src="site/media/readme-hero.png" width="100%" alt="nexu" />
</p>

<h1 align="center">nexu</h1>

<p align="center">
  <strong>最もシンプルなオープンソース OpenClaw 🦞 デスクトップクライアント — WeChat &amp; Feishu 対応</strong>
</p>

<p align="center">
  <a href="https://github.com/nexu-io/nexu/releases"><img src="https://img.shields.io/github/v/release/nexu-io/nexu?color=blue" alt="Release" /></a>
  <a href="https://github.com/nexu-io/nexu/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <a href="https://github.com/nexu-io/nexu/stargazers"><img src="https://img.shields.io/github/stars/nexu-io/nexu?style=social" alt="Stars" /></a>
</p>

<p align="center">
  <a href="https://nexu.io" target="_blank" rel="noopener"><strong>🌐 公式サイト</strong></a> &nbsp;·&nbsp;
  <a href="https://docs.nexu.io" target="_blank" rel="noopener"><strong>📖 ドキュメント</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/nexu-io/nexu/discussions"><strong>💬 Discussions</strong></a> &nbsp;·&nbsp;
  <a href="https://github.com/nexu-io/nexu/issues"><strong>🐛 Issues</strong></a> &nbsp;·&nbsp;
  <a href="https://x.com/nexudotio" target="_blank" rel="noopener"><strong>𝕏 Twitter</strong></a>
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;·&nbsp; <a href="README.zh-CN.md">简体中文</a> &nbsp;·&nbsp; 日本語
</p>

---

> 🦞 **WeChat × OpenClaw を最もスムーズに接続**：スキャンして即接続、すぐ使える。
>
> 🎉 **ベータ特典**：ベータ期間中、Claude、GPT、Gemini、Kimi、GLM などのトップモデルが **完全無料・無制限** でご利用いただけます。[今すぐダウンロード →](https://nexu.io)

---

## 📋 nexu とは？

**nexu**（next to you）は、**OpenClaw 🦞** の Agent を WeChat、Feishu、Slack、Discord などの IM 上で直接動かせるオープンソースのデスクトップクライアントです。

WeChat ＋ OpenClaw に対応 — WeChat 8.0.7 の OpenClaw プラグインと連携します。接続をクリックし、WeChat でスキャンするだけで、AI Agent とチャットを始められます。

ダウンロードしてすぐ使える — グラフィカルなセットアップ、Feishu Skills 内蔵、複数モデル対応（Claude / GPT / Gemini など）、お持ちの API キーも利用可能です。

IM に接続すれば、Agent は 24 時間オンライン — スマートフォンからいつでもどこでもチャットできます。

データはすべて端末に留まります。プライバシーは完全にあなたの手の中にあります。

<p align="center">
  <video src="site/media/readme-wechat-demo-en.mov" width="100%" autoplay loop muted playsinline>
    お使いのブラウザは動画再生に対応していません。<a href="site/media/readme-wechat-demo-en.mov">動画をダウンロード</a>してご覧ください。
  </video>
</p>

---

## 📊 他のソリューションとの比較

| | OpenClaw（公式） | 典型的なホスト型 Feishu ＋ エージェント構成 | **nexu** ✅ |
|---|---|---|---|
| **🧠 モデル** | 持ち込み可だが手動設定が必要 ⚠️ | プラットフォーム固定で切り替え不可 ❌ | **Claude / GPT / Gemini などを選択 — GUI でワンクリック切り替え** ✅ |
| **📡 データ経路** | ローカル | ベンダー経由でサーバー外に出る、コントロール不能 ❌ | **ローカルファースト。ビジネスデータは当社がホストしません** ✅ |
| **💰 コスト** | 無料だが自前デプロイが必要 ⚠️ | サブスク / 席課金など ❌ | **クライアントは無料。プロバイダーへの支払いはご自身の API キー経由** ✅ |
| **📜 ソース** | オープンソース | クローズドソースで監査不可 ❌ | **MIT — フォークして監査可能** ✅ |
| **🔗 チャネル** | 自前連携が必要 ⚠️ | ベンダー次第でしばしば限定的 ❌ | **WeChat、Feishu、Slack、Discord を内蔵 — すぐ使える** ✅ |
| **🖥 インターフェース** | CLI、技術スキルが必要 ❌ | ベンダー次第 | **純 GUI、CLI 不要、ダブルクリックで起動** ✅ |

---

## 機能

### 🖱 ダブルクリックでインストール

ダウンロードしてダブルクリック、すぐ利用開始。環境変数も、依存関係の格闘も、長いインストール手順も不要。nexu の初回起動時点で十分な機能が揃っており、そのまま使い始められます。

### 🔗 内蔵 OpenClaw 🦞 Skills ＋ フル Feishu Skills

ネイティブな OpenClaw 🦞 Skills とフル Feishu Skills を同梱。追加の連携なしに、チームがすでに使っている実務ワークフローに Agent を組み込めます。

### 🧠 トップモデルをすぐに

nexu アカウント経由で Claude 4.6、ChatGPT 5.4、Minimax 2.5、GLM 5.0、Kimi 2.5 などをそのまま利用。余計な設定は不要。いつでもお持ちの API キーに切り替え可能です。

### 🔑 お持ちの API キー、アカウント不要

ご自身のモデルプロバイダーを使いたい場合は API キーを追加するだけ。アカウント作成やログインなしでクライアントを利用できます。

### 📱 IM 連携、モバイル対応

WeChat、Feishu、Slack、Discord に接続すれば、スマートフォンですぐに AI エージェントが使えます。別アプリは不要 — WeChat やチームチャットを開いて、移動中でもエージェントと会話できます。

### 👥 チーム向けに設計

中核はオープンソース。実際に動くデスクトップ体験。チームがすでに信頼しているツールとモデルスタックと互換性があります。

---

## ユースケース

nexu は **ワンパーソンカンパニー** と小規模チーム向け — 一人で、ひとつの AI チーム。

### 🛒 個人 EC / 越境販売

> *「週末まるごと 3 言語でリスティングを書いていました。今は Feishu で Agent に商品スペックを伝えるだけ。コーヒーを飲み終える頃には、Amazon、Shopee、TikTok Shop 向けのリスティングができあがっています。」*

商品調査、競合価格、リスティング最適化、多言語マーケ素材 — 一週間分を午後ひとつぶりに圧縮。

### ✍️ クリエイター / ナレッジブロガー

> *「月曜の朝：Slack で Agent に今週のトレンドを聞く。昼までに Xiaohongshu、WeChat、Twitter 向けに下書きが 5 本 — それぞれプラットフォームに合ったトーンで。」*

トレンド追跡、ネタ出し、マルチプラットフォームのコンテンツ制作、コメント対応 — ひとりでコンテンツマトリクスを回せます。

### 💻 インディー開発者

> *「深夜 3 時のバグ調査？スタックトレースを Discord に貼ると、Agent がレース条件まで追い、修正案を提案し、PR の説明文まで下書きしてくれる。眠らないペアプロ。」*

コードレビュー、ドキュメント生成、バグ分析、反復作業の自動化 — Agent がペアプロの相手になります。

### ⚖️ 法務 / 金融 / コンサル

> *「クライアントが Feishu で 40 ページの契約書を送ってくる。Agent に転送する — 10 分後にはリスク要約、要注意条項、修正案の提案が届く。半日かかっていたのが、コーヒーブレイクで済む。」*

契約レビュー、規制調査、レポート作成、クライアント Q&amp;A — ドメイン知識を Agent のスキルに変換。

### 🏪 地域ビジネス / 小売

> *「真夜中に客から『在庫ある？』とメッセージ。Feishu の Agent がリアルタイム在庫で自動返信し、返品対応までして、プロモクーポンまで送る。ようやく眠れる。」*

在庫管理、注文フォロー、顧客メッセージへの自動返信、マーケ文面 — AI に店舗運営を手伝ってもらう。

### 🎨 デザイン / クリエイティブ

> *「Slack にざっくりブリーフを投げる：『ペットフード向け LP、遊び心ある雰囲気』。キックオフの前に、コピー案、カラーパレットの提案、参考画像が返ってくる。」*

要件の分解、アセット検索、コピーライティング、デザイン注釈 — 創作時間を確保し、反復作業を減らす。

---

## 🚀 はじめに

### 動作環境

- 🍎 **OS**：macOS 12 以降（Apple Silicon）
- 💾 **ストレージ**：約 500 MB

### インストール

**ビルド済み Mac クライアント（推奨）**

1. [公式サイト](https://nexu.io) または [Releases](https://github.com/nexu-io/nexu/releases) へ 📥
2. Mac 用インストーラーをダウンロード
3. nexu を起動 🎉

> ⏳ **Windows および macOS Intel**：開発中です。最新情報は [support@nexu.ai](mailto:support@nexu.ai) までメールでお問い合わせください。

### 初回起動

nexu アカウントでサインインすれば対応モデルにすぐアクセスできるほか、お持ちの API キーを追加してアカウントなしで利用することもできます 🔑。

---

## 🛠 開発

### 前提条件

- **Node.js** 22 以上（LTS 推奨）
- **pnpm** 10 以上

### リポジトリ構成（抜粋）

```text
nexu/
├── apps/
│   ├── api/              # Backend API
│   ├── web/              # Web frontend
│   ├── desktop/          # Desktop client (Electron)
│   └── controller/       # Controller service
├── packages/shared/      # Shared libraries
├── docs/
├── tests/
└── specs/
```

### コマンド

```bash
pnpm run dev             # Dev stack with hot reload
pnpm run dev:desktop     # Desktop client
pnpm run build           # Production build
pnpm run lint
pnpm test
```

---

## 🤝 コントリビュート

コントリビュート歓迎！英語の完全ガイドはリポジトリルートの [CONTRIBUTING.md](CONTRIBUTING.md) にあります（PR 作成時に GitHub が表示します）。同じ内容が [docs.nexu.io — Contributing](https://docs.nexu.io/guide/contributing) にも掲載されています。**中文：** [docs.nexu.io (zh)](https://docs.nexu.io/zh/guide/contributing) · [docs/zh/guide/contributing.md](docs/zh/guide/contributing.md)。

1. 🍴 このリポジトリをフォーク
2. 🌿 フィーチャーブランチを作成（`git checkout -b feature/amazing-feature`）
3. 💾 変更をコミット（`git commit -m 'Add amazing feature'`）
4. 📤 ブランチにプッシュ（`git push origin feature/amazing-feature`）
5. 🔀 Pull Request を開く

### ガイドライン

- 既存のコードスタイルに従う（Biome; `pnpm lint` を実行）
- 新機能にはテストを書く
- 必要に応じてドキュメントを更新
- コミットはアトミックかつ説明的に

---

## ❓ FAQ

**Q: nexu は無料ですか？**
A: クライアントは完全無料かつオープンソース（MIT）です。内蔵のトップモデルをご利用いただけるほか、お持ちの API キーを使用することも可能です。

**Q: どの OS に対応していますか？**
A: 現在 macOS 12 以降（Apple Silicon）に対応しています。Windows および macOS Intel は開発中です。最新情報は [support@nexu.ai](mailto:support@nexu.ai) までお問い合わせください。

**Q: どの IM プラットフォームに対応していますか？**
A: WeChat、Feishu、Slack、Discord を内蔵しており、すぐに使えます。

**Q: データは安全ですか？**
A: すべてのデータは端末に保存されます。nexu がビジネスデータをホストすることはありません。ソースコードはオープンで監査可能です。

**Q: 自分の API キーを使えますか？**
A: はい。API キーを追加するだけで、アカウント作成やログインなしで利用できます。

**Q: WeChat に接続するには何が必要ですか？**
A: WeChat 8.0.7 の OpenClaw プラグインに対応しています。接続をクリックし、WeChat でスキャンするだけで完了です。追加の設定は不要です。

---

## 💬 コミュニティ

コミュニティの主な場所は GitHub です。新しいスレッドを立てる前に、既存のものを検索して重複を避けてください。

| チャンネル | 用途 |
|---------|-------------|
| 💡 [**Discussions**](https://github.com/nexu-io/nexu/discussions) | 質問、アイデアの提案、ユースケースの共有など。**Q&amp;A** カテゴリでトラブルシューティング、**Ideas** で機能ブレスト。 |
| 🐛 [**Issues**](https://github.com/nexu-io/nexu/issues) | バグ報告や機能リクエスト。Issue テンプレートをご利用ください。 |
| 📋 [**Roadmap &amp; RFCs**](https://github.com/nexu-io/nexu/discussions/categories/rfc-roadmap) | 今後の計画をフォローし、設計ディスカッションに参加。 |
| 📧 [**support@nexu.ai**](mailto:support@nexu.ai) | プライベートなお問い合わせ、パートナーシップなど。 |

### コントリビューター

<a href="https://github.com/nexu-io/nexu/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nexu-io/nexu" alt="Contributors" />
</a>

---

## ⭐ Star 履歴

<a href="https://star-history.com/#nexu-io/nexu&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=nexu-io/nexu&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=nexu-io/nexu&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=nexu-io/nexu&type=Date" />
 </picture>
</a>

---

## 📄 ライセンス

nexu は [MIT License](LICENSE) のもとでオープンソース化されています。商用利用を含め、自由に使用・改変・配布できます。

オープンソースは AI インフラの未来だと信じています。フォーク、コントリビュート、または nexu をベースに自分のプロダクトを構築してください。

---

<p align="center">nexu チームが ❤️ を込めて開発</p>
