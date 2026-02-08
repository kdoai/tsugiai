# TSUGIAI - 引き継ぎ確認AI

>  **AIエージェントを活用した業務引き継ぎチェックリスト＆チェックアウトシステム**
>
> AI-powered work handover checklist and checkout system built with Google ADK + Gemini3.0

---

## 概要 / Overview

**TSUGIAI** は、業務の引き継ぎプロセスを AI エージェントで効率化するシステムです。業種・職種に合わせたチェックリストの自動生成から、対話形式でのチェックアウト、引き継ぎドキュメントの自動作成までを一気通貫で行います。

### 製造業における引き継ぎの課題

製造業（特に交替勤務のある現場）では、シフト交代時の引き継ぎは **安全上の重要なコミュニケーション工程** です。

- 英国 HSE は、シフト引き継ぎ時のコミュニケーション失敗により多くの事故が発生していると明記し、Sellafield や Piper Alpha 等の具体例を挙げています（[HSE - Shift handover](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm)）
- HSE の交替勤務ガイダンス（HSG256）は、交替勤務では別シフト間の接触が少なくコミュニケーションが悪化し得ることを指摘し、引き継ぎ品質の確保を推奨しています（[HSG256 - Managing shift work](https://assets.publishing.service.gov.uk/media/5a7ef36540f0b6230268c8de/hsg256_managing_shift_work.pdf)）
- IChemE の論文は、コミュニケーション不良が重大事故に寄与し、引き継ぎは有意なリスクを生む可能性があると述べています（[IChemE - Shift Handover](https://www.icheme.org/media/8907/xxiv-paper-11.pdf)）
- HSE 系の文献レビュー（OTO 96 003）でも、引き継ぎ時のコミュニケーション失敗が寄与因子とされた事故・インシデント調査が複数あると明記されています（[Effective Shift Handover - Literature Review](https://humanfactors101.com/wp-content/uploads/2016/04/effective-shift-handover-a-literature-review.pdf)）

こうした背景のもと、現場では以下の課題が見られます。

| 課題 | 背景・リスク |
|------|-------------|
| **引き継ぎの抜け漏れ** | 口頭伝達への依存により情報伝達不備が起きやすく、事故要因になり得ることが指摘されている（[HSE](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm)）。夜勤→日勤など前シフトの担当者と直接接触できないケースではリスクが高まる |
| **チェックリストの形骸化** | 紙やフォームによる確認は惰性入力が混入し得るため、システム側で通過条件（入力内容の検証・順序のランダム化等）を設計する必要がある |
| **ドキュメント作成の負荷** | 引き継ぎ書を手書き・Excel 等で作成する工数がかかり、内容の質にもばらつきが生じやすい |
| **暗黙知の喪失** | 人員の異動・退職時に「設備のクセ」「工程の注意点」といった暗黙知が引き継がれず消失するリスクがある |
| **後任からのフィードバック不在** | 引き継ぎ内容に不足があっても前任に確認する仕組みがなく、フィードバックループが成立しにくい |

### TSUGIAI が提供する解決策

TSUGIAI は **AI エージェントが対話形式で引き継ぎを確認** することで、これらの課題を構造的に解決します。

- **抜け漏れ防止** — AI が項目を 1 つずつ順番に確認し、「火災」「故障」「漏れ」「事故」「怪我」等の危険キーワードを検出すると自動的に 2〜3 回の深掘り質問を実施
- **惰性入力の防止** — 紙・フォームでの確認は惰性入力が混入し得るため、システム側に複数の通過条件を設計。NG 回答には必ず詳細（状態・対応状況）の入力を要求し、**「NGが正の回答」設定**（`expected_answer: "ng"`）で否定形質問への反射的な OK を NG 扱いに反転。さらに **ランダム順序表示** で毎回異なる順番にし、パターン化された惰性回答を抑止
- **ドキュメント自動生成** — AI が会話内容から引き継ぎドキュメントとアクションアイテムを自動構造化。手書き不要
- **暗黙知の蓄積** — 対話ログが Firestore に蓄積され、過去の引き継ぎ内容を検索・参照可能
- **双方向フィードバック** — 後任者がコメント・質問を残せる仕組みで、引き継ぎの改善サイクルが回る

### 期待される効果

**定量的効果:**

| 指標 | 従来 | TSUGIAI 導入後 | 改善率 |
|------|------|---------------|--------|
| 引き継ぎ書の作成時間 | 手書き・Excel 等で負荷がかかる | AI が対話内容から自動生成 | 大幅削減 |
| 引き継ぎ起因のリスク | 情報伝達不備が事故要因になり得る（[HSE](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm)） | ハードゲート + AI レビューで抜け漏れを構造的に排除 | — |
| チェックリスト作成工数 | 1時間以上（業種ごとに手動作成） | 10分（AI が業種・職種から自動生成） | 約 80% 削減 |

**定性的効果:**

- 引き継ぎ品質の属人性排除（誰が担当しても同じ粒度で確認される）
- Gemini Live API によるリアルタイム音声対話で、手が離せない現場でもハンズフリーで引き継ぎ可能
- 引き継ぎ履歴のデータベース化により、過去の設備トラブルや対応履歴をナレッジとして蓄積
- 後任者の心理的安全性向上（不明点をコメントで気軽に確認できる）

### English Summary

TSUGIAI is an AI-driven handover checklist system designed for shift-based industries like manufacturing. It automatically generates checklists tailored to industry and job type, conducts conversational checkouts with AI agents (Google ADK + Gemini), and produces handover documents — all with voice input support and multi-tenant architecture. The system structurally prevents handover omissions by using AI to sequentially verify each item, auto-detect critical keywords, and generate structured documentation.

---

## AI モデルとエージェント構成 / AI Models & Agents

### 使用モデル

| モデル | 用途 | 通信方式 | 設定 |
|--------|------|---------|------|
| **Gemini Live 2.5 Flash Native Audio** | Phase 3 音声対話（リアルタイム双方向） | WebSocket（`BidiGenerateContent`） | Voice: Aoede / PCM 16kHz↔24kHz |
| **Gemini 3 Flash Preview** | チェックアウトテキスト対話・テンプレート生成・引き継ぎドキュメント生成・**ファイル分析** | REST（Google ADK + Function Calling） | Temperature 0.3〜0.8 / Top P 0.95 |

- **テキスト対話** では Google ADK（Agent Development Kit）を通じて Gemini を呼び出し、Function Calling によるツール実行を組み合わせたエージェント構成
- **音声対話** では Gemini Live API の `BidiGenerateContent` を WebSocket で直接呼び出し、STT・LLM・TTS をすべて Gemini 内部でネイティブ処理。従来の REST ベース（Google Cloud Speech API → Gemini → Cloud TTS）と比較して **レイテンシを 2〜4 秒 → 200〜400ms に短縮**（※[Google公式ドキュメント](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-live)の公称値。実測値は環境により変動）
- **ファイル分析** では Gemini のマルチモーダル機能を使用し、PDF・画像ファイルから既存のチェックリストを読み取ってテンプレートを自動生成

### 3 つの AI エージェント

```
┌─────────────────────────────────────────────────────────┐
│                   AI Agent 構成                         │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────────────────┐ │
│  │ Template Agent   │  │ Checkout Agent               │ │
│  │                  │  │                              │ │
│  │ 業種・職種から   │  │ チェックリストを1項目ずつ    │ │
│  │ チェックリストを │  │ AI が対話形式で確認。        │ │
│  │ 自動生成         │  │ 危険キーワード検出時は       │ │
│  │                  │  │ 自動で深掘り質問。           │ │
│  │ Tools:           │  │                              │ │
│  │  - save_template │  │ Tools:                       │ │
│  │  - suggest_items │  │  - save_check_response       │ │
│  │    _for_industry │  │  - add_to_parking_lot        │ │
│  │  - validate_     │  │  - request_photo             │ │
│  │    template      │  │  - mark_item_complete        │ │
│  └─────────────────┘  │  - get_session_progress      │ │
│                        │  - complete_checkout         │ │
│  ┌─────────────────┐  └──────────────────────────────┘ │
│  │ Handover Agent   │                                   │
│  │                  │                                   │
│  │ 対話結果から     │                                   │
│  │ 引き継ぎノートと │                                   │
│  │ アクションアイテ │                                   │
│  │ ムを自動生成     │                                   │
│  │                  │                                   │
│  │ Tools:           │                                   │
│  │  - generate_     │                                   │
│  │    handover_note │                                   │
│  │  - generate_     │                                   │
│  │    action_items  │                                   │
│  │  - analyze_      │                                   │
│  │    conversation  │                                   │
│  │  - format_for_   │                                   │
│  │    notification  │                                   │
│  └─────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

#### 1. Template Agent（テンプレート生成エージェント）

業種・職種を対話で聞き取り、最適なチェックリストテンプレートを自動生成します。

- 2〜3 の質問で業種を特定し、製造業・小売・オフィス・医療等のプリセットを提案
- チェックボックス / 数値入力 / テキスト / 選択肢 / 写真 / AI 対話確認の 6 種類のアイテムタイプに対応
- 数値項目には範囲・閾値・許容差のバリデーションルールを設定可能
- **NGが正の回答**（`expected_answer: "ng"`）: 否定形の質問（「漏れはないか？」「異常はないか？」等）で OK を押すと NG 扱いにする反転設定。テンプレートビルダーで項目ごとに設定可能。この項目に OK を押して次へ進もうとすると **警告ダイアログが表示** され、Phase 3 の AI 対話で「なぜ OK と回答したか」を確認される。形骸化・惰性回答の防止に有効
- **ランダム順序** + **固定位置**: テンプレート単位でランダム表示を有効化（`randomize_order: true`）。各項目は「ランダム」か「固定位置（1, 2, 3...）」を選択可能。Fisher-Yates シャッフルで順序を決定し、`sessionStorage` で同一セッション内は順序を保持。毎回異なる順序で表示されるため、パターン化された惰性回答を防止

#### 2. Checkout Agent（チェックアウト対話エージェント）

引き継ぎ時の核となるエージェントです。チェックリストの各項目を **1 つずつ順番に** 確認し、問題を検出した際には自動的に深掘りします。

- **テキストモード** と **音声モード** を選択可能（Phase 3 開始時）
- **音声モード** では Gemini Live API（`gemini-live-2.5-flash-native-audio`）を WebSocket で使用し、リアルタイムの双方向音声対話を実現。STT・LLM 推論・TTS をすべて Gemini 内部でネイティブ処理するため、応答レイテンシは 200〜400ms（Google公称値）
- **1 メッセージ 1 質問ルール** を厳守し、オペレーターに負荷をかけない対話設計
- NG 回答には「未対応 / 対応中 / 解決済み」のステータスと詳細の入力を要求
- **NG 項目の理由確認（Phase 3）**: NG 項目を 1 つずつ理由確認し、「やり忘れ・怠慢」と「正当な理由」を判定。やり忘れの場合は Phase 1 への差し戻しを提案（クイックリプライ: フォーム入力に戻ってやり直す / このまま続ける）、正当な理由の場合は了承して次へ進む。担当者が「このまま続ける」を選択した場合は強制しない（ソフトゲート）
- **「NGが正の回答」項目の確認**: `expected_answer: "ng"` が設定された項目に OK と回答した場合、AI が「なぜ OK と回答したのか」を確認。惰性で全 OK を押した場合、ここで検出される
- 「火災」「事故」「故障」「漏れ」「警報」等の **危険キーワードを自動検出** → 2〜3 回の追加質問で状況を把握
- ユーザーの割り込み（バージイン）に対応し、AI の発話を中断して即座に応答

#### 3. Handover Agent（引き継ぎドキュメント生成エージェント）

チェックアウト対話の結果を構造化された引き継ぎドキュメントに変換します。

- 未完了タスク、設備状況、安全確認、連絡事項のセクションに自動分類
- **アクションアイテム** を自動生成：「いつ」「どうなったら」「どうするか」「根拠（会話からの引用）」を構造化
- 監視タスク・条件分岐タスク・時間指定タスクを区別して生成
- Slack / Teams / Email への通知フォーマットに変換可能

### AI エージェントが生み出す価値

| 従来の方法 | AI エージェントによる改善 |
|-----------|------------------------|
| 紙・フォームは惰性入力が混入し得る | AI が 1 項目ずつ対話で確認し、NG には必ず深掘り。必須項目の未回答はハードゲートでブロック。NG 項目は AI がやり忘れか正当理由かを判定して差し戻しを提案（ソフトゲート）。「NGが正の回答」で否定形質問の OK を NG 扱いに反転し、ランダム順序で惰性回答を抑止 |
| 問題の重要度は担当者の主観判断 | 危険キーワード検出で客観的に問題を把握 |
| 引き継ぎ書を手動で記述 | 対話ログから引き継ぎノート + アクションアイテムを自動生成 |
| チェックリストは管理者が手動で設計 | 業種・職種を入力するだけで AI がテンプレートを提案 |
| テキスト入力のみ | Gemini Live API による 200〜400ms のリアルタイム音声対話。手が汚れている・手袋をしている製造現場でもハンズフリーで利用可能 |
| 引き継ぎ内容は紙で散逸 | Firestore に構造化データとして蓄積。検索・集計・傾向分析が可能 |

---

## 機能一覧 / Features

| 機能 | 説明 |
|------|------|
| **AI チェックリストビルダー** | 業種・職種から最適なチェックリストテンプレートを対話形式で生成 |
| **ファイル分析によるテンプレート生成** | 既存の PDF・画像ファイルをアップロードすると、Gemini のマルチモーダル機能でチェックリストを自動抽出してテンプレート化 |
| **マルチフェーズチェックアウト** | Phase 1（フォーム入力）→ Phase 2（写真・AI 判定）→ Phase 3（AI 対話レビュー）→ Phase 4（確認・完了） |
| **必須項目ゲート** | Phase 1→2、Phase 2→3 の遷移時に必須項目の未回答・未アップロードをバックエンドとフロントエンドの両方でバリデーション（ハードゲート） |
| **NG 項目差し戻し** | Phase 3 の AI レビューで「やり忘れ・怠慢」と判定された NG 項目に対し、Phase 1 への差し戻しを提案。担当者の判断を尊重するソフトゲート設計 |
| **NGが正の回答（トラップ質問）** | 否定形の質問（「漏れはないか？」「異常はないか？」等）で OK を押すと NG 扱いにする反転設定（`expected_answer: "ng"`）。見た目の OK/NG ボタンは変えず、内部ロジックのみ反転。**OK を押して次へ進もうとすると警告ダイアログが表示**され、「このまま進む場合、AI確認フェーズで理由を確認されます。続けますか？」と通知。Phase 3 の AI 対話で「なぜ OK と回答したのか」を確認される。形骸化・惰性回答の防止に有効 |
| **ランダム順序 + 固定位置** | テンプレート単位で確認項目の表示順をランダム化。各項目は「ランダム」か「固定位置（1, 2, 3...）」を選択可能。Fisher-Yates シャッフル + `sessionStorage` による同一セッション内の順序保持。毎回異なる順番で表示されるため、パターン化された惰性での全 OK 回答を防止 |
| **リアルタイム音声対話** | Gemini Live API（WebSocket）によるリアルタイム双方向音声対話。レイテンシ 200〜400ms（Google公称値）。バージイン対応 |
| **危険キーワード自動検出** | 「火災」「故障」「漏れ」等を検出し、AI が自動で深掘り確認 |
| **引き継ぎドキュメント生成** | 対話結果からアクションアイテム付きの引き継ぎノートを自動作成 |
| **写真添付・AI 判定** | 設備の状態を写真で記録し、AI が画像を分析して「OK / 要確認」を判定 |
| **コメント・フィードバック** | 後任者が各項目にコメント・質問を残し、引き継ぎの改善サイクルを形成 |
| **マルチテナント** | テナント単位でのデータ分離・管理 |
| **ロールベースアクセス制御** | owner / admin / user / viewer による権限管理 |

### チェックアウトフロー詳細

```
Phase 1: フォーム入力（ランダム順序対応）
┌────────────────────────────────────┐
│ チェックリストの各項目をフォームで  │
│ 入力（ランダム順序 ON なら毎回     │
│ 異なる表示順 = 惰性回答防止）      │
│                                    │
│ - checkbox (OK/NG)                 │
│   ※ expected_answer="ng" の項目は  │
│     OK押下→NG扱い（反転）          │
│ - 数値（範囲検証）                 │
│ - テキスト                         │
│ - 選択肢                           │
│                                    │
│ NG → 詳細入力を要求                │
└──────────────┬─────────────────────┘
               │
        ┌──────┴──────┐
        │ ハードゲート │ 必須項目が未回答なら400エラー
        │  (Backend   │ フロントでも即座にバリデーション
        │  + Frontend)│ → 未回答項目を明示して通さない
        └──────┬──────┘
               │
        ┌──────┴──────┐
        │ 警告ゲート  │ expected_answer="ng" の項目に
        │ (Frontend)  │ OKを押した場合、警告ダイアログ:
        │             │ 「AI確認フェーズで理由を確認
        │             │   されます。続けますか？」
        │             │ → キャンセル可能（ソフトゲート）
        └──────┬──────┘
               │
               ▼
Phase 2: 写真・AI判定（写真項目がなければスキップ）
┌────────────────────────────────────┐
│ 写真が必要な項目のみ               │
│ 写真アップロード                   │
│ → AI が画像を分析                  │
│ → OK / 要確認 を判定               │
│                                    │
│ ※写真項目がない場合 Phase 3 へ直行 │
└──────────────┬─────────────────────┘
               │
        ┌──────┴──────┐
        │ ハードゲート │ 必須写真が未アップロードなら
        │  (Backend)  │ 400エラーで通さない
        └──────┬──────┘
               │
               ▼
Phase 3: AI対話レビュー（テキスト or 音声）
┌────────────────────────────────────┐
│ AI が全回答をレビュー              │
│                                    │
│ - NG項目を1つずつ理由確認          │
│   → やり忘れ: Phase 1差し戻し提案  │
│   → 正当理由: 了承して次へ         │
│ - 「NGが正の回答」項目でOKを押した │
│   場合、AIが「なぜOKと回答したか」 │
│   を確認（トラップ質問の検証）     │
│ - 危険KW検出→追加質問             │
│ - テキスト or 音声                 │
│   音声=Gemini Live API             │
│                                    │
│ ソフトゲート: 提案はするが          │
│ 担当者の判断を尊重（強制しない）   │
└──────────────┬─────────────────────┘
               │  ※Phase 1への差し戻しも可能
               ▼
Phase 4: 確認・完了（引き継ぎノート + アクションアイテム自動生成）
┌────────────────────────────────────┐
│ AI生成ドキュメント                 │
│                                    │
│ - 未完了タスク                     │
│ - 設備状況                         │
│ - 安全確認                         │
│ - アクションアイテム               │
│                                    │
│ 確認→完了・後任に通知              │
└────────────────────────────────────┘
```

---

## アーキテクチャ / Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                               │
│              React + Vite + Tailwind CSS                    │
│                 Firebase Hosting                            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
              ┌────────────────────────────────┐
              │     Agents (Python/FastAPI)    │
              │   Google ADK + Gemini          │
              │   Cloud Run                    │
              │                                │
              │  - checkout_agent (対話AI)     │
              │  - template_agent (テンプレ生成)│
              │  - handover_agent (ドキュメント)│
              └──────────┬─────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Google Cloud Services                    │
│                                                             │
│  ┌──────────┐ ┌───────────────┐ ┌────────────────────────┐ │
│  │Firestore │ │Cloud Storage  │ │Gemini Live API         │ │
│  │(Database)│ │(Attachments)  │ │(WebSocket双方向音声)   │ │
│  └──────────┘ └───────────────┘ └────────────────────────┘ │
│                                                             │
│  ┌──────────────────┐  ┌─────────────────────────────────┐ │
│  │Firebase Auth     │  │Firebase Cloud Functions         │ │
│  │(認証)            │  │(テナント管理)                   │ │
│  └──────────────────┘  └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

| サービス | 役割 | デプロイ先 |
|----------|------|-----------|
| Frontend | React SPA、ユーザーインターフェース | Firebase Hosting |
| Agents | AI エージェント、チェックアウト対話 | Cloud Run |
| Functions | テナント管理（作成・招待・権限移譲） | Cloud Functions |
| Firestore | データベース（マルチテナント構造） | Firebase |
| Cloud Storage | ファイル・写真の保存 | GCS |

---

## 技術スタック / Tech Stack

| レイヤー | 技術 |
|----------|------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router |
| **Agents** | Python 3.11, FastAPI, Google ADK, Gemini, Pydantic |
| **Functions** | Firebase Cloud Functions (Node.js 20, TypeScript) |
| **Database** | Cloud Firestore（マルチテナント構造） |
| **Storage** | Google Cloud Storage |
| **Authentication** | Firebase Authentication |
| **Voice** | Gemini Live API（`BidiGenerateContent` / WebSocket リアルタイム双方向音声） |
| **Infrastructure** | Google Cloud Run, Cloud Build, Firebase Hosting |
| **CI/CD** | Cloud Build（自動ビルド＆デプロイ） |

---

## ディレクトリ構成 / Project Structure

```
interview-ai/
├── frontend/                # React SPA（Vite + TypeScript）
│   ├── src/
│   │   ├── components/      # UIコンポーネント
│   │   │   ├── common/      #   共通コンポーネント（Layout, ProtectedRoute）
│   │   │   ├── chat/        #   チャットUI
│   │   │   ├── checkout/    #   チェックアウト関連コンポーネント
│   │   │   ├── dashboard/   #   ダッシュボード
│   │   │   └── wizard/      #   ウィザードUI
│   │   ├── contexts/        # React Context（Auth, Admin, Tenant）
│   │   ├── hooks/           # カスタムフック
│   │   ├── lib/             # Firebase SDK 設定
│   │   ├── pages/           # ページコンポーネント
│   │   │   ├── checkout/    #   チェックアウトフロー（Phase 1〜4）
│   │   │   ├── LoginPage           # ログイン
│   │   │   ├── AuthVerifyPage      # 認証確認
│   │   │   ├── CheckoutStartPage   # チェックアウト開始
│   │   │   ├── VoiceCheckoutPage   # 音声チェックアウト
│   │   │   ├── HandoverHomePage    # 引き継ぎホーム
│   │   │   ├── HandoverListPage    # 引き継ぎ一覧
│   │   │   ├── HandoverPage        # 引き継ぎ詳細
│   │   │   ├── InboxPage           # 受信トレイ
│   │   │   ├── TemplatesPage       # テンプレート一覧
│   │   │   ├── TemplateBuilderPage # テンプレート作成
│   │   │   ├── SettingsPage        # 設定
│   │   │   ├── TenantSelectPage    # テナント選択
│   │   │   ├── TenantOnboardingPage# テナントオンボーディング
│   │   │   └── TenantSettingsPage  # テナント設定
│   │   ├── services/        # API クライアント・音声ユーティリティ
│   │   └── types/           # 型定義
│   └── package.json
│
├── agents/                  # Python AIエージェント（FastAPI + ADK）
│   ├── checkout_agent/      # チェックアウト対話エージェント
│   │   ├── agent.py         #   エージェント定義
│   │   ├── prompts.py       #   プロンプト
│   │   └── tools.py         #   ツール実装
│   ├── template_agent/      # テンプレート生成エージェント
│   │   └── agent.py         #   エージェント・ツール
│   ├── handover_agent/      # 引き継ぎドキュメント生成エージェント
│   │   └── agent.py         #   エージェント・ツール
│   ├── models/              # Pydanticモデル
│   │   └── checklist.py
│   ├── services/            # Firestore, Storage, Speech連携
│   │   ├── firestore.py
│   │   ├── storage.py
│   │   └── speech.py
│   ├── middleware/          # FastAPI ミドルウェア（認証）
│   │   └── auth.py
│   ├── scripts/             # ユーティリティスクリプト
│   │   └── seed_templates.py
│   ├── main.py              # エントリーポイント
│   ├── Dockerfile
│   └── requirements.txt
│
├── functions/               # Firebase Cloud Functions
│   ├── src/                 # TypeScriptソース
│   │   └── index.ts         #   テナント管理・招待機能
│   └── package.json
│
├── migration/               # マルチテナント移行スクリプト
│   ├── migrate-to-multitenant.ts
│   └── verify-migration.ts
│
├── docs/                    # ドキュメント
│
├── firebase.json            # Firebase設定
├── firestore.rules          # Firestoreセキュリティルール
├── firestore.indexes.json   # Firestoreインデックス
└── .firebaserc              # Firebaseプロジェクト設定
```

---

## 前提条件 / Prerequisites

| ツール | バージョン | 用途 |
|--------|-----------|------|
| Node.js | 20.x | Frontend / Functions |
| Python | 3.11+ | Agents（AI エージェント） |
| Firebase CLI | 最新 | Firebase デプロイ・エミュレータ |
| gcloud CLI | 最新 | GCP リソース管理 |
| Docker | 最新 | コンテナビルド（任意） |

### 必要な GCP サービス

**必須:**

- Cloud Firestore
- Cloud Storage
- Cloud Run
- Cloud Build
- Generative Language API（Gemini）
- Firebase Authentication
- Firebase Hosting

---

## セットアップ / Getting Started

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd interview-ai
```

### 2. Firebase プロジェクトの設定

```bash
cp .firebaserc.example .firebaserc
# .firebaserc 内の "your-project-id" を実際のプロジェクトIDに変更
```

### 3. 環境変数の設定

```bash
# Agents
cp agents/.env.example agents/.env
```

`.env` ファイルを編集し、GCP プロジェクト ID や API キーを設定してください（詳細は [環境変数一覧](#環境変数一覧--environment-variables) を参照）。

### 4. Functions（ビルド）

```bash
cd functions
npm install
npm run build
```

### 5. Firebase エミュレータの起動

Functions のビルド後にエミュレータを起動します（Auth・Firestore・Functions・Hosting をローカルで動作させるため）。

```bash
firebase emulators:start
```

エミュレータ UI: http://localhost:4000

| エミュレータ | ポート |
|-------------|--------|
| Auth | 9099 |
| Firestore | 8081 |
| Functions | 5001 |
| Hosting | 5000 |

### 6. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### 7. Agents（Python）

```bash
cd agents
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
# → http://localhost:8080
```

---

## 環境変数一覧 / Environment Variables

### Agents（Python）

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `GOOGLE_CLOUD_PROJECT` | GCP プロジェクト ID | `my-project-id` |
| `GOOGLE_CLOUD_API_KEY` | Google Cloud API キー | `AIza...` |
| `GOOGLE_APPLICATION_CREDENTIALS` | サービスアカウントキーのパス | `./sa-key.json` |
| `PORT` | サーバーポート | `8080` |
| `HOST` | バインドアドレス | `0.0.0.0` |
| `ENV` | 実行環境 | `development` / `production` |
| `STORAGE_BUCKET` | Cloud Storage バケット名 | `my-project-handover-attachments` |

### Frontend（ビルド時）

| 変数名 | 説明 | 例 |
|--------|------|-----|
| `VITE_HANDOVER_API_URL` | Agents API の URL | `http://localhost:8080` |
| `VITE_FIREBASE_API_KEY` | Firebase API キー | `AIza...` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth ドメイン | `your-project.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase プロジェクト ID | `your-project-id` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage バケット | `your-project.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Messaging Sender ID | `123456789` |
| `VITE_FIREBASE_APP_ID` | Firebase App ID | `1:123456789:web:abc123` |

---

## デプロイ / Deployment

### Cloud Build による CI/CD

#### Agents パイプライン（`agents/cloudbuild.yaml`）

Python AI エージェントサーバーをデプロイします。

```bash
gcloud builds submit --config agents/cloudbuild.yaml
```

**処理内容:**
1. Agents の Docker イメージをビルド → Artifact Registry に Push
2. Cloud Run にデプロイ（asia-northeast1）

### 手動デプロイ

```bash
# Firestore ルール・インデックスのデプロイ
firebase deploy --only firestore

# Cloud Functions のデプロイ
firebase deploy --only functions

# Frontend のデプロイ
cd frontend && npm run build
firebase deploy --only hosting

# Agents の Cloud Run デプロイ
cd agents
gcloud builds submit --config cloudbuild.yaml
```

---

## ライセンス / License

MIT License. See [LICENSE](LICENSE) for details.
