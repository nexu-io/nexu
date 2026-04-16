# Good First Issue コントリビューターガイド

**nexu** を使ったことがある方、あるいは「IM + デスクトップクライアント + デジタルクローン」のような製品に興味がある方、ぜひ **Good First Issue** から最初の PR を始めてみてください。

**Good First Issue コントリビューター** を継続的に募集しています。

これはメンテナーがあらかじめスコープを区切った小さなタスクです。範囲が明確で、方向が絞られており、初めてオープンソースに参加する方にぴったりです。

## なぜ初参加に向いているのか

- **取り組みやすい**：通常は一つの方向だけ。アーキテクチャ全体を理解する必要はありません。
- **検証しやすい**：範囲が小さく、受入基準が明確で、自分でテストできます。
- **フィードバックが早い**：このタイプの Issue はレビューが進みやすいです。

## こんな方におすすめ

以下のいずれかに当てはまるなら、`good-first-issue` から始めるのがおすすめです：

- オープンソースへの貢献が初めて
- UX、ドキュメント、i18n、フロントエンドのインタラクションに関心がある
- まずは小さなタスクから始めて、プロジェクトに慣れたい
- レビュアーと一緒に修正を完成させる意欲がある

直接見てみる：

- [Good First Issue リスト](https://github.com/nexu-io/nexu/labels/good-first-issue)
- [GitHub Issues](https://github.com/nexu-io/nexu/issues)
- [コントリビュートガイド](/ja/guide/contributing)

## 貢献すると何が得られるか

あなたの貢献がマージされたら、「PR がマージされた」だけでは終わりません：

- 貢献は公開表示とリーダーボードに反映
- 努力はルールに基づいてポイントとして記録
- 初回貢献者にはフォローアップの提案があります

詳細ルール：

- [コントリビューター報酬＆サポート](/ja/guide/contributor-rewards)

## 3ステップ：観察者から貢献者へ

### 1. タスクを選ぶ

[Good First Issue リスト](https://github.com/nexu-io/nexu/labels/good-first-issue) を開き、興味のあるタスクを選んで、Issue にコメントして担当を宣言してください。

おすすめの最初のタスク：

- コピー / i18n の修正
- 小規模な UI / インタラクションの問題
- ドキュメントの補足
- 再現が明確で検証しやすい小さなバグ

### 2. ガイドを読んで環境構築

コーディングを始める前に、[コントリビュートガイド](/ja/guide/contributing) を一通り読んでください。

最低限必要なセットアップ：

```bash
git clone https://github.com/nexu-io/nexu.git
cd nexu
pnpm install
```

コードを変更する場合は、少なくとも以下を実行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

ドキュメントを変更する場合は、ローカルプレビュー：

```bash
cd docs
pnpm install
pnpm dev
```

### 3. PR を提出する

リポジトリを Fork し、分かりやすいブランチ名を作成し、PR の説明に以下を記載：

- 関連する Issue 番号
- 何を変更したか
- どう検証するか
- UI の変更がある場合はスクリーンショットか動画

マージ後、感謝とポイント記録のフローに入ります。

## コミュニティに参加 💬

一人で調べるよりみんなで話す方が早い。グループにはメンテナーや経験豊富なコントリビューターがいます。参加して、最初の貢献について話しましょう 👇

👉 [nexu Discord に参加](https://discord.gg/vMrySTJW8u)
👉 [nexu Feishu グループに参加](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=bd9j6550-d1ee-41e6-8bbb-7e735ae88ba2)

<img src="/feishu-contributor-qr.png" width="200" alt="nexu Feishu コントリビューターグループ" />

## よくある質問

### シニアエンジニアじゃなくても大丈夫？

もちろんです。Good First Issue はまさに初回貢献者のためのエントリーポイントです。

### 英語が苦手でも大丈夫？

Issue / PR は中国語・英語どちらもチームが確認します。まずコントリビュートガイドを読んでみてください。言語は壁ではありません、始めることが大切です。

### AI を使ってコードを書いてもいい？

はい。PR で AI アシスタントを使ったかどうかと、自分で何を検証したかを簡単に説明することをお勧めします。

### PR を出しても放置されない？

できる限り公開スケジュールでレビューします。Good First Issue の PR は通常より早くフィードバックがありますが、メンテナーの状況によります。

## 最後に

オープンソースの一番面白いところは、あなたの変更がバージョン履歴に残り、実際にユーザーに使われることです。

準備ができたら、[Good First Issue](https://github.com/nexu-io/nexu/labels/good-first-issue) から始めましょう。
