/**
 * シミュレーションの出来事に合わせた効果音と、場面に合わせた曲（src/ui/audio.ts で鳴らす）。
 * 煽らないよう、音は控えめに、ここぞというときだけ（docs/02 の表現の方針）。
 */
import type { ScenarioDef, SimEvent, World } from '../sim/types';

const DISTRESS = new Set(['LOST_AWARE', 'INCAPACITATED', 'WAITING_RESCUE', 'BIVOUAC', 'UNCONSCIOUS', 'SEEKING_SIGNAL', 'DESCENDING_DRAINAGE', 'NAVIGATING_TO_TRAIL', 'BACKTRACKING']);

/** 出来事 → 効果音（なければ null） */
export function eventSound(e: SimEvent): { id: string; volume: number } | null {
  const d = e.data ?? {};
  switch (e.type) {
    case 'SOUND':
      return typeof d['id'] === 'string' ? { id: d['id'], volume: typeof d['volume'] === 'number' ? d['volume'] : 1 } : null;
    case 'CHOICE_FIRED':
      return { id: 'message', volume: 1 };
    case 'RESCUE_CALLED':
      // 通りかかった人が下りてから通報するときは、その場では電話の音を鳴らさない
      return d['via'] === 'passerby' ? null : { id: 'phone', volume: 1 };
    case 'HELI_DISPATCH':
    case 'GROUND_DISPATCH':
      return { id: 'mil-radio', volume: 0.8 };
    case 'RESCUED':
      return d['by'] === 'heli' ? { id: 'mil-helicopter', volume: 1 } : null;
    case 'CARDIAC_ARREST':
      return { id: 'heartbeat', volume: 1 };
    case 'SCRIPT_LOG':
      if (d['passerby']) return { id: 'footsteps', volume: 0.8 };
      return d['illnessOnset'] || d['anaphylaxisOnset'] ? { id: 'heartbeat', volume: 0.9 } : null;
    case 'FALL':
    case 'GUST_FALL':
      return d['injury'] && d['injury'] !== 'none' && d['injury'] !== 'bruise' ? { id: 'bass-drop', volume: 0.9 } : null;
    default:
      return null;
  }
}

/** 場面の曲。シナリオの music で上書きできる（null は無音） */
export function autoMusic(w: World, s: ScenarioDef): string | null {
  const m = s.music ?? {};
  const active = w.climbers.filter((c) => c.body.alive && c.state !== 'FINISHED' && c.state !== 'RESCUED' && !c.offMap);
  const distress = active.some((c) => DISTRESS.has(c.state) || c.body.illness?.active === true || (c.body.injury !== 'none' && c.body.injury !== 'bruise'));
  if (distress) return m.distress === undefined ? 'drama-dive' : m.distress;
  if (w.sun.isDark) return m.night === undefined ? 'ambient-deep-breath' : m.night;
  return m.play === undefined ? 'wilderness-c' : m.play;
}

/** 結末の曲 */
export function endingMusic(kind: string, s: ScenarioDef): string {
  const bad = kind === 'FATAL' || kind === 'MISSING' || kind === 'RESCUED_CRITICAL';
  const m = s.music ?? {};
  if (bad) return m.bad ?? (kind === 'FATAL' ? 'quiet-night-c' : 'drama-dusk');
  return m.good ?? 'ambient-before-dawn';
}
