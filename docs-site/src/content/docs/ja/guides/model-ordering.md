---
title: モデルの並び順について
description: opencodex が Codex モデルピッカーと spawn_agent モデルオーバーライドの順序を決める方式。
---

Codex モデルピッカーは opencodex 設定に書かれたプロバイダー宣言順やモデル配列順を保存しません。
最終順序はカタログ priority で決まり、同じ priority を持つルーティングモデルには決定論的
アルファベット順ソートが適用されます。


`modelPickerOrder` は、おすすめとネイティブを含むすべての利用可能なモデルを並べ替えます。空でないリストでは指定した ID が配列順で先頭に並び、未指定のモデルは自然な優先順位で続きます。ネイティブ ID の有無は関係ありません。正確なカタログ ID を使い、アカウント指定行には selector を含めます。

## Codex が適用するルール

Codex の models-manager はピッカーに表示されるカタログ項目を `priority` 昇順でソートします。
カタログ配列順は捨てるため、生成された JSON 配列で項目を前に動かしてもピッカーでは前に移動しません。この制約は `src/codex/catalog/sync.ts` に直接記録されています。

そのため opencodex は配列位置ではなくより低い priority を付与してフィーチャー位置を制御します。
この表の固定値と以下の例は、有効な account selector がない構成を説明します。`N` 個の selector が
ある場合、設定 rank `i` の featured bare native は priority `i * N + j` の selector 行へ展開され、
`j` は 0 から始まる selector の位置です。featured routed 行には `i * N`、exact
account-qualified native id にはその selector の `i * N + j` が使用されます。Codex が公開するのは
引き続きピッカーに表示される最初の 5 行だけです。選択されていない routed 行は、これらの selector
グループの外へ移動されます。

selector がない場合の priority は次のとおりです。

以下の優先順位表と例は、ピッカー全体の並び替えを有効にしていない場合のものです。

| カタログ項目 | Priority | 根拠 |
 --- | ---: | --- |
| `subagentModels[i]` | `i`(`0` から `4`) | `src/codex/catalog/sync.ts` の featured rank map |
| その他のルーティングモデル | `5` | `src/codex/catalog/sync.ts` のルーティング項目生成 |
| デフォルトネイティブ GPT スラッグ | `9` | `src/codex/catalog/sync.ts` のネイティブ項目生成 |
| featured リストがあるとき選択されていないネイティブモデル | 最小 `featured.length + 100` | `src/codex/catalog/sync.ts` のネイティブカタログマージ |

管理 API は `src/server/management/agent-settings-routes.ts` の `slice(0, 5)` で `subagentModels` を最大
5 つに制限します。これは最初の 5 モデルオーバーライドだけを広告する Codex `spawn_agent` サーフェスと合致します。
5 つ以降のモデルもメインピッカーに引き続き表示でき、正確な ID で呼び出し可能です。

## 同じ priority 内の順序

一般ルーティングモデルはすべて priority `5` なので同点ソートが必要です。カタログ項目を作る前に
`gatherRoutedModels()` がルーティングモデル一覧をプロバイダー名順、次にモデル ID 順でアルファベットソートします
(`src/codex/catalog/provider-fetch.ts`)。

したがって次の設定の順序は最終ソートに影響しません。

- `providers` オブジェクトで key を宣言した順序
- 各プロバイダーの `models` 配列に ID を書いた順序

その後 `orderForSubagents()` が stable sort を使い、フィーチャー済みモデルを `subagentModels` に書いた順に
前に動かします。フィーチャー以外のモデルは前に決定されたプロバイダー/ID アルファベット相対順序を保ちます
(`src/codex/catalog/sync.ts`)。項目生成時の featured rank も priority `0` から `4` に変換されるため
Codex の priority ソートでもこの先頭順序は保存されます。

## 公開可否と順序は別物

`selectedModels` と `disabledModels` はどのルーティングモデルを公開するか決めるだけで、ソートを制御しません。
`filterCatalogVisibleModels()` は 2 つの選択リストを `Set` ルックアップに変換し、配列をランクとして使わず
収集した一覧をフィルタします(`src/codex/catalog/provider-fetch.ts`)。

したがって `selectedModels` や `disabledModels` の配列順序を変えてもピッカー位置は変わりません。
変わり得るのはモデルの包含可否だけです。

## 最終ピッカーパターン

有効な account selector がなく、featured リストが空でない場合の最終順序は次のとおりです。

1. 設定された `subagentModels` 順どおりに、priority `0` から `4` を受けたモデル
2. 残りのすべてのルーティングモデル、プロバイダー順とモデル ID 順アルファベットソート、priority `5`
3. カタログマージ過程で featured ブロックの下に押し下げられた選択されていないネイティブモデル

`subagentModels` がない場合、ルーティングモデルは priority `5` を維持し、ネイティブ GPT 項目は通常 priority
(opencodex が作った項目は通常 `9`)を使います。ルーティンググループ内部は引き続きプロバイダー/ID
アルファベット順です。

## 例

`subagentModels` に次の 5 つの ID がこの順序で入っているとします。

```toml
subagentModels = [
  "gpt-5.5",
  "opencode-go/glm-5.2",
  "anthropic/claude-opus-4-6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]
```

ピッカーの先頭順序は次のとおりです。

| ピッカー位置 | モデル | Priority | この位置に表示される理由 |
 ---: | --- | ---: | --- |
| 1 | `gpt-5.5` | `0` | 最初の `subagentModels` 選択 |
| 2 | `opencode-go/glm-5.2` | `1` | プロバイダーが `anthropic` より後でも 2 番目の選択なのでこの位置に表示 |
| 3 | `anthropic/claude-opus-4-6` | `2` | 3 番目の選択 |
| 4 | `gpt-5.6-sol` | `3` | 4 番目の選択 |
| 5 | `gpt-5.6-terra` | `4` | 5 番目の選択 |
| 6 | `anthropic/claude-fable-5` | `5` | 残りのルーティングモデルのうちプロバイダー/ID アルファベット順の最初 |
| 7 以降 | 残りのルーティングモデル | `5` | プロバイダー アルファベット順、同じプロバイダー内ではモデル ID アルファベット順 |
| ルーティングモデルの後 | 残りのネイティブモデル | `featured.length + 100` 以上 | 選択されていないネイティブモデルは featured ブロックの下に移動 |

最初の 5 項目は `spawn_agent` に広告されるオーバーライドで、残りは通常のピッカー順序に続きます。

account selector がある場合、5 項目の制限は bare native の選択が selector-qualified グループへ
展開された後に適用されます。

## 順序を変える方法

先頭モデルの順序を変更するサポート手段は、`subagentModels` を並べ替えることです。
ダッシュボードの **Sub-agents** ページでは bare native id と routed id を並べ替えられます。
設定と `ocx agent subagents set` は exact account-qualified
`<selector>/<native-openai-model>` id も受け付けます。ダッシュボードは保存済みの id を現在利用できなくても保持します。設定する id は最大 5 つにしてください。account selector がある
場合は 1 つの bare native が複数の selector-qualified 行に展開されるため、設定した選択肢と公開
される行は必ずしも一対一ではありません。

`modelPickerOrder` は、おすすめとネイティブを含むすべての利用可能なモデルを並べ替えます。空でないリストでは指定した ID が配列順で先頭に並び、未指定のモデルは自然な優先順位で続きます。ネイティブ ID の有無は関係ありません。正確なカタログ ID を使い、アカウント指定行には selector を含めます。

**Models → Custom order** で任意の行をドラッグするか上下ボタンで移動し、下書きを保存します。おすすめの印は移動を制限しません。新しいモデルは保存済み順序の後に追加されます。名前・プロバイダー・使用量のプリセットもネイティブを含みます。使用量は適用時のスナップショットです。既存のルーティング専用リストもおすすめより優先されます。Default で自然な順序に戻せます。

`pickerAvailable` と保存時の検証は同じ可視モデル集合を使用します。`subagentModels` とフォールバックは変更しません。OpenCodex のガイダンスは自然順位を維持しますが、Codex の `spawn_agent` が表示する先頭5候補は変わる場合があります。これは名前指定の許可リストではありません。

保存前に最新状態を確認し、競合時は下書きを保持して再読み込みを求めます。カタログ更新が保留なら、古いカタログを持つ Codex を開き直してください。Claude のネイティブ接頭部分は変わりません。[詳細](/guides/model-ordering/)。
