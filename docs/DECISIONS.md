# 決定記録

仕様があいまいだった点、仕様から変えた点、依存の追加を 1〜3 行で記録する。新しいものを下に足す。

## 2026-11-18（P0 以前・人間の判断）

- **見た目の方針**: 目標は「精密なジオラマ模型」。写真レベルは目指さない。人はレゴのミニフィギュアを参考にしたブロック玩具風の人形（特定製品の形の複製・商標の使用はしない）。docs/00 §4・docs/10 §3.2/§5/§9/§10・docs/13 P8/P12 を書き換えた。
- **容量**: 初回ロード 1.5MB は基本部分に適用し、高品質アセットは後から読み込む（合計の目安 20MB）。NFR-03・docs/10 §10。
- **依存の方針**: 質が上がり手間が減るライブラリは、追加前に人間に確認したうえで使ってよい（CLAUDE.md「依存の追加」）。docs/03・11・15・16 の「自作」指定を緩めた。

## P0 土台

- **依存の版**: three 0.187、@types/three 0.187、vite 8.3、typescript 7.0、vitest 5.1、tsx 4.23（いずれも導入時点の最新）。Vite 8 では `build.rollupOptions` が非推奨のため `build.rolldownOptions.input` でマルチページを設定した。
- **@types/node の追加**（人間が承認）: `tools/` と `vite.config.ts` が `process`・`fs` を使い、型検査に必要なため。実行時のバンドルには入らない。MIT。
- **npm audit の警告**: vitest/vite が使う picomatch に ReDoS の注意（high）。開発時だけの依存で、渡すグロブは自分の設定だけなので実害はない。修正案は vite 6 への巻き戻しで不適当なため、上流の更新を待つ。
- **sim の純粋性は 2 重に守る**: `tools/purity.ts`（文字列・コメントを除いて検査）に加え、`tsconfig.sim.json` で `src/sim` を DOM・Node の型なしで型検査する（`npm run typecheck` に含めた）。
- **purity の対象を少し広げた**: docs/13 P0 の項目と `fetch` に加え、引数なしの `new Date()`、`performance` 全体、`navigator`、`localStorage`/`sessionStorage`/`indexedDB`、`XMLHttpRequest`/`WebSocket`/`EventSource` も禁止にした。
- **types.ts の同期**: `src/sim/types.ts` と `docs/appendix/types.ts` が一致することをテスト（`tests/types-sync.test.ts`）で確認する。型を変えるときは両方を直す。

## 仕様の食い違いの扱い（実装時に従う）

- **分岐点待ちの位置**: docs/03 §4 の補足どおり、`if (world.pendingChoice && mode === 'interactive') return` をステップ 1 の前に置く。
- **`StaticContext`**: docs/03 §3 の 3 項目ではなく、types.ts の定義（`mode`・`policy`・`events` を含む）を正とする。
- **`goToMember` アクション**: types.ts と汎用分岐点 `straggler` にあるが docs/09 §6 の表にない。P19 で実装し、そのとき表に足す。
- **`speech.ts` の場所**: docs/03 の構成にないため `src/sim/climber/speech.ts` に置く（乱数は `thoughts` ストリーム）。
- **P10 の受け入れ基準のうち s04 の項目**: s04 が動くのは P19 以降のため、P10 では s01〜s03 で確認し、s04 の項目は P19 で確認する。
- **生理モデル**: P4 から docs/06 の改訂版の式（年齢・地面伝導・雨具下の蒸発など）で実装し、P4 では C1〜C9、P19 で C10〜C13 を検証する。
