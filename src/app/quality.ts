/**
 * 画質の自動判定（docs/10 §9、FR-42）。GPU 名・画面・コア数から low / mid / high を推定し、設定に保存する。
 * 開始後に描画が重ければ（平均 30fps 未満が 5 秒続く）1 段下げる提案をする（simScreen 側）。
 */
export type Quality = 'low' | 'mid' | 'high';

export function detectQuality(): Quality {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // 取れなければ中
  }
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile) return cores >= 8 && /Apple|Adreno \(TM\) 7|Mali-G7/i.test(gpu) ? 'mid' : 'low';
  if (/SwiftShader|llvmpipe|Software/i.test(gpu)) return 'low';
  if (/NVIDIA|GeForce|RTX|Radeon RX|Radeon Pro|Apple M[1-9] (Pro|Max|Ultra)/i.test(gpu) && cores >= 8) return 'high';
  return 'mid';
}
