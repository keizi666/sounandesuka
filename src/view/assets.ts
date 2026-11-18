/**
 * 高品質用の追加アセットの後読み込み（docs/10 §10）。
 * 高品質のときだけ、シナリオ開始後に裏で読み込み、届いたら差し替える。失敗しても基本のまま続ける（エラーにしない）。
 */
import * as THREE from 'three';
import { assetUrl } from '../app/data';
import type { EnvUniforms } from './terrainMaterial';

interface Manifest {
  version: 1;
  files: { file: string; bytes: number }[];
}

export type HqState = 'none' | 'loading' | 'loaded' | 'failed';

export async function loadHqAssets(env: EnvUniforms, renderer: THREE.WebGLRenderer): Promise<HqState> {
  try {
    const res = await fetch(assetUrl('assets/hq/manifest.json'));
    if (!res.ok) return 'failed';
    const m = (await res.json()) as Manifest;
    if (!m.files.some((f) => f.file === 'terrain_detail.png')) return 'failed';
    const tex = await new THREE.TextureLoader().loadAsync(assetUrl('assets/hq/terrain_detail.png'));
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.NoColorSpace;
    env.uDetail.value = tex;
    env.uDetailOn.value = 1;
    return 'loaded';
  } catch {
    return 'failed';
  }
}
