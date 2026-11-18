/// <reference lib="webworker" />
/**
 * 電波圏の計算（docs/03 §8）。マップ定義を受け取り、派生レイヤー込みで電波強度を計算して返す（Transferable）。
 */
import { buildMapRuntime } from '../sim/terrain/map';
import type { MapDef } from '../sim/types';

self.onmessage = (ev: MessageEvent<{ def: MapDef }>) => {
  const { map } = buildMapRuntime(ev.data.def, { radio: true });
  const radio = map.radio;
  (self as unknown as Worker).postMessage({ radio }, [radio.buffer]);
};
