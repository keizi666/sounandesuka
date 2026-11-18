/**
 * 自動選択の方針（docs/14 §3）。観察のみモード・時間切れ・ヘッドレス実行で使う。
 */
import { nextFloat, pickWeighted } from './core/rng';
import type { ChoiceOptionDef, PolicyName, World } from './types';

export interface WeightedOption {
  option: ChoiceOptionDef;
  /** 自律バイアスの重み（mods を足した後、0 未満は 0） */
  weight: number;
}

/** 自律バイアスで選ぶ（choice ストリームで重み比例。全部 0 なら最初の選択肢） */
export function pickByBias(world: World, opts: readonly WeightedOption[]): ChoiceOptionDef {
  const i = pickWeighted(world.rng.choice, opts.map((o) => o.weight));
  return (i >= 0 ? opts[i] : opts[0])!.option;
}

/**
 * 方針で選ぶ。opts は選べる（available を満たす）選択肢だけ。
 * recommended / risky はタグの付いた最初の選択肢、なければ bias。historical は記録の選択、なければ bias。
 */
export function chooseByPolicy(
  world: World,
  policy: PolicyName,
  cpId: string,
  opts: readonly WeightedOption[],
  recorded?: Record<string, string>,
): ChoiceOptionDef {
  if (opts.length === 0) throw new Error(`分岐点 ${cpId} に選べる選択肢がありません`);
  switch (policy) {
    case 'recommended':
    case 'risky': {
      const tag = policy === 'recommended' ? 'recommended' : 'risky';
      const o = opts.find((x) => x.option.tags?.includes(tag));
      return o ? o.option : pickByBias(world, opts);
    }
    case 'random':
      return opts[Math.floor(nextFloat(world.rng.choice) * opts.length)]!.option;
    case 'historical': {
      const id = recorded?.[cpId];
      const o = opts.find((x) => x.option.id === id);
      return o ? o.option : pickByBias(world, opts);
    }
    case 'bias':
    default:
      return pickByBias(world, opts);
  }
}
