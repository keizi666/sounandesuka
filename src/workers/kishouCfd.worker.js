// 気象の計算ワーカー（3D の非静力学モデル＋雲物理）。
// 出典: 作者のサイトの気象シミュレータ「テングラフィカ」（kzi.jp/kishou.html）の kishou_worker.js を、作者の承認のうえ組み込んだもの。
// 変更点: 巻き戻し用の保存点を作らない（メモリを節約。巻き戻しは使わない）。
// 描画用（src/view/kishouClouds.ts）。シミュレーション（src/sim）の結果には使わない（決定論を保つため）。
/* eslint-disable */
// ウェザーグラフィカ 気象計算ワーカー
// 3 次元の非静力学ブシネスク近似モデル（スタッガード格子・セミラグランジュ移流・圧力の射影）
// + ケスラー型の暖かい雨／冷たい雨の簡易雲物理 + 地表面の熱収支 + 雷の電荷モデル
'use strict';

const G = 9.81, CP = 1004.0, RD = 287.0, RV = 461.5, LV = 2.5e6, P00 = 100000.0, KAPPA = RD / CP;
const DTMAX = 25; // 時間の刻み（秒）の上限。セミラグランジュ移流なので長めでも安定
// 雪の密度（水量 mm ÷ 深さ cm）。新雪は 0.05〜0.15 g/cm³、しまった雪は 0.3〜0.35 g/cm³
const SNOW_OLD_RHO = 3.0, SNOW_SETTLED_RHO = 3.5, SNOW_SETTLE_TAU = 36 * 3600;
function newSnowRho(Ta) { return Math.max(0.6, Math.min(1.5, 0.7 + 0.08 * (Ta - 263.15))); } // 寒いほどふわふわ

let NX, NY, NZ, DX, DY, DZ, LKM, HKM;
let NC; // セル数
let U, V, W, U2, V2, W2;      // 面の速度
let TH, QV, QC, QR, TH2, QV2, QC2, QR2; // セル中心のスカラー
let UC, VC, WC;               // セル中心の速度（作業用）
let PHI, DIV;
let solid, kg, hcell, sea;    // 地形
let zc, th0, qv0, pi0, p0, rho0, T0, ub, vb; // 基本場（高さ別）
let Tg, soil, snow, rainRate, accum, charge, Ta2, lwp; // 地表（列）
let snowD; // 積雪の深さ（cm）。snow は水量（mm）
let params = null;
let simTime = 0;
let running = false;
let speed = 60;
let flashes = [];
let flashTotal = 0, flashRecent = [];
let rng = mulberry32(12345);
let fCor = 8e-5;

function mulberry32(a) {
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

const iU = (i, j, k) => i + (NX + 1) * (j + NY * k);
const iV = (i, j, k) => i + NX * (j + (NY + 1) * k);
const iW = (i, j, k) => i + NX * (j + NY * k);
const iC = (i, j, k) => i + NX * (j + NY * k);

function qsat(T, p) {
	// テテンの式（0℃ 以下は氷に対する飽和を少し混ぜる）
	const tc = T - 273.15;
	let es;
	if (tc >= 0) es = 610.78 * Math.exp(17.27 * tc / (T - 35.86));
	else {
		const ew = 610.78 * Math.exp(17.27 * tc / (T - 35.86));
		const ei = 610.78 * Math.exp(21.875 * tc / (T - 7.66));
		const f = Math.min(1, -tc / 20);
		es = ew * (1 - f) + ei * f;
	}
	return 0.622 * es / Math.max(p - es, 1000);
}

// ---------- 太陽 ----------
function sunInfo(t) {
	const P = params;
	const hours = P.startHour + t / 3600;
	const dayAdd = Math.floor(hours / 24);
	const doy = P.doy + dayAdd;
	const hjst = hours - dayAdd * 24;
	const g = 2 * Math.PI / 365 * (doy - 1 + (hjst - 12) / 24);
	const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
	const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
	const solarMin = hjst * 60 + eqt + 4 * (P.lon - 135);
	const ha = (solarMin / 4 - 180) * Math.PI / 180;
	const lat = P.lat * Math.PI / 180;
	const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
	return sinEl;
}

// ---------- 初期化 ----------
// 基本場（水平に一様な大気の鉛直分布）を条件から計算する
function computeBase(P) {
	const o = {
		th0: new Float32Array(NZ), qv0: new Float32Array(NZ), T0: new Float32Array(NZ), p0: new Float32Array(NZ),
		pi0: new Float32Array(NZ), rho0: new Float32Array(NZ), ub: new Float32Array(NZ), vb: new Float32Array(NZ),
	};
	const Ts = P.tsfc + 273.15;
	const trop = P.tropopause * 1000;
	const lapse = P.lapse / 1000;
	const zi = (P.invH || 0) * 1000;
	const tempAt = (z) => {
		let T = z < trop ? Ts - lapse * z : Ts - lapse * trop + 0.001 * (z - trop);
		// 上空の寒気・暖気（高度 5.5 km を中心に）
		T += P.coldAloft * Math.exp(-Math.pow((z - 5500) / 2200, 2));
		// 逆転層（その高さより上が暖かい）
		if (zi > 0) { const f = Math.min(1, Math.max(0, (z - zi) / 350)); T += (P.invT || 0) * f * f * (3 - 2 * f); }
		return T;
	};
	let p = 101300, zPrev = 0;
	for (let k = 0; k < NZ; k++) {
		const z = (k + 0.5) * DZ;
		const n = 20;
		for (let s = 0; s < n; s++) {
			const za = zPrev + (z - zPrev) * s / n, zb = zPrev + (z - zPrev) * (s + 1) / n;
			p *= Math.exp(-G * (zb - za) / (RD * tempAt((za + zb) / 2)));
		}
		zPrev = z;
		const T = tempAt(z);
		o.T0[k] = T; o.p0[k] = p; o.pi0[k] = Math.pow(p / P00, KAPPA); o.th0[k] = T / o.pi0[k];
		o.rho0[k] = p / (RD * T);
		let rhRel = P.rh / 100 * (1 - 0.65 * Math.min(1, z / 10000));
		// 気象の再現から引き継いだ高さごとの湿り（0〜12 km、1 km ごと）
		let prof = null;
		if (P.rhProf && P.rhProf.length > 1) {
			const f = Math.min(P.rhProf.length - 1.001, Math.max(0, z / 1000)), i0 = Math.floor(f);
			prof = P.rhProf[i0] + (P.rhProf[i0 + 1] - P.rhProf[i0]) * (f - i0);
			rhRel = prof;
		}
		if (zi > 0 && z > zi + 200) rhRel *= (P.invDry != null ? P.invDry : 0.45);
		// 上空の湿った層（つるし雲・笠雲・高層の雲のもと）
		if (P.moistH > 0) {
			const w = Math.exp(-Math.pow((z - P.moistH * 1000) / (Math.max(0.3, P.moistThick || 1) * 500), 2));
			rhRel = rhRel * (1 - w) + (P.moistRH || 92) / 100 * w;
		}
		if (z > trop) rhRel *= 0.3;
		rhRel = Math.max(0.03, rhRel);
		// 湿った層は少しだけ過飽和を許す（上空の冷たい所は氷に対して飽和すると巻雲になる）
		let cap = 0.995;
		if (P.moistH > 0 && (P.moistRH || 0) > 100) cap = Math.min((P.moistRH || 0) / 100, 1.03);
		if (prof != null && prof > 0.97) cap = 1.0; // 雲のある層は飽和のまま（雲が蒸発して消えないように）
		o.qv0[k] = Math.min(qsat(T, p) * rhRel, qsat(T, p) * cap);
		const d0 = P.windDir * Math.PI / 180;
		const u0 = -P.windSpeed * Math.sin(d0), v0 = -P.windSpeed * Math.cos(d0);
		const dU = (P.upperDir != null ? P.upperDir : 270) * Math.PI / 180;
		const uUp = -P.upperWind * Math.sin(dU), vUp = -P.upperWind * Math.cos(dU);
		const f = Math.min(1, z / 10000);
		const fs = f * f * (3 - 2 * f);
		o.ub[k] = u0 + (uUp - u0) * fs;
		o.vb[k] = v0 + (vUp - v0) * fs;
	}
	return o;
}
let tgt = null;
// ---------- 気象の再現からの外の場（入れ子の計算の外側の条件）
// lsW：場所ごとの大規模な上昇気流（m/s、対流圏の中ほどで最大）。前線・低気圧が広い範囲の空気を持ち上げる分で、範囲の中では起こせない
// bQC/bQV/bQR：縁のスポンジ層で寄せる先（気象の再現の雲・湿り・雨）。縁から雲を含んだ空気が入ってくる
let lsW = null, bQC = null, bQV = null, bQR = null;
function buildOuter(cl) {
	const n = cl.n, nzc = cl.nz, N2 = NX * NY;
	const at = (A, i, j, k) => A[(Math.max(0, Math.min(n - 1, i)) + n * Math.max(0, Math.min(n - 1, j))) * nzc + k];
	// 降水は周り 3×3 でならす（山の風上だけの雨を大規模な上昇と見なさないように。山の雨はこの計算で地形が作る）
	const prS = new Float32Array(n * n), cvF = new Float32Array(n * n);
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
		let s2 = 0, c = 0;
		for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
			const ii = Math.max(0, Math.min(n - 1, i + di)), jj = Math.max(0, Math.min(n - 1, j + dj));
			s2 += cl.precip[ii + n * jj]; c++;
		}
		prS[i + n * j] = Math.min(s2 / c, cl.precip[i + n * j] * 1.5 + 0.5);
		// 対流性の雲の割合（積乱雲の雨は、この計算の中で対流が作るので大規模な上昇に入れない）
		let cs = 0, ds = 0;
		for (let k = 0; k < nzc; k++) { const d = at(cl.dens, i, j, k); ds += d; cs += d * (cl.conv ? at(cl.conv, i, j, k) : 0); }
		cvF[i + n * j] = ds > 0 ? cs / ds : 0;
	}
	lsW = new Float32Array(N2);
	bQC = new Float32Array(NC); bQV = new Float32Array(NC); bQR = new Float32Array(NC);
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		const fx = (i + 0.5) / NX * n - 0.5, fy = (j + 0.5) / NY * n - 0.5;
		const i0 = Math.floor(fx), j0 = Math.floor(fy), ax = fx - i0, ay = fy - j0;
		const b2 = (A) => { const g = (ii, jj) => A[Math.max(0, Math.min(n - 1, ii)) + n * Math.max(0, Math.min(n - 1, jj))]; return (g(i0, j0) * (1 - ax) + g(i0 + 1, j0) * ax) * (1 - ay) + (g(i0, j0 + 1) * (1 - ax) + g(i0 + 1, j0 + 1) * ax) * ay; };
		const pr = b2(prS), cv = b2(cvF);
		// 層状の雨 1 mm/h を降らせるのに、対流圏の中ほどでおよそ 3.5 cm/s の上昇
		lsW[c2] = Math.min(0.35, 0.035 * pr * (1 - 0.8 * cv));
		const bil = (k) => (at(cl.dens, i0, j0, k) * (1 - ax) + at(cl.dens, i0 + 1, j0, k) * ax) * (1 - ay) + (at(cl.dens, i0, j0 + 1, k) * (1 - ax) + at(cl.dens, i0 + 1, j0 + 1, k) * ax) * ay;
		const prRaw = b2(cl.precip);
		let top = 0;
		for (let k = 0; k < NZ; k++) {
			const c = iC(i, j, k);
			bQV[c] = qv0[k]; bQC[c] = 0; bQR[c] = 0;
			if (k < kg[c2]) continue;
			const z = zc[k] / 1000, kc = Math.min(nzc - 1, Math.max(0, Math.floor(z)));
			const fz = z - (kc + 0.5), kn = Math.min(nzc - 1, Math.max(0, kc + (fz > 0 ? 1 : -1)));
			const d = bil(kc) * (1 - Math.abs(fz)) + bil(kn) * Math.abs(fz);
			if (d < 0.08) continue;
			const qs = qsat(T0[k], p0[k]);
			bQV[c] = Math.max(qv0[k], qs * Math.min(1, 0.97 + 0.03 * d));
			bQC[c] = Math.min(6e-4, 2.5e-4 * d * (T0[k] < 253 ? 0.4 : 1));
			if (zc[k] > top) top = zc[k];
		}
		if (prRaw > 0.2 && top > 0) for (let k = kg[c2]; k < NZ && zc[k] <= top; k++) bQR[iC(i, j, k)] = Math.min(2e-3, 1.1e-4 * Math.sqrt(prRaw));
	}
}
// 場所ごとの大規模な上昇：基本場の温位・水蒸気を上へ運ぶ分の冷却と湿り（空気は持ち上がって冷え、下の湿った空気が上がってくる）
function largeScaleLift(dt) {
	if (!lsW) return;
	const sxy = NX * NY, trop = params.tropopause * 1000;
	for (let k = 1; k < NZ - 1; k++) {
		const shape = Math.sin(Math.PI * Math.min(1, zc[k] / trop));
		if (shape <= 0) continue;
		const dthdz = (th0[k + 1] - th0[k - 1]) / (2 * DZ), dqdz = (qv0[k + 1] - qv0[k - 1]) / (2 * DZ);
		const o = sxy * k;
		for (let c2 = 0; c2 < sxy; c2++) {
			const w = lsW[c2];
			if (w <= 0) continue;
			const c = o + c2;
			if (solid[c]) continue;
			const ws = dt * w * shape;
			TH[c] -= ws * dthdz;
			QV[c] = Math.max(0, QV[c] - ws * dqdz);
		}
	}
}
function buildBase() {
	const o = computeBase(params);
	zc = new Float32Array(NZ);
	for (let k = 0; k < NZ; k++) zc[k] = (k + 0.5) * DZ;
	th0 = o.th0; qv0 = o.qv0; T0 = o.T0; p0 = o.p0; pi0 = o.pi0; rho0 = o.rho0; ub = o.ub; vb = o.vb;
	tgt = computeBase(params);
}
// 条件が変わったら、その目標へ基本場をゆっくり近づける（気温・湿度の差は内部の空気にも同じだけ足す）
let nudgeTau = 1800;
function nudge(dt) {
	if (!tgt) return;
	const r = Math.min(1, dt / nudgeTau);
	const sxy = NX * NY;
	for (let k = 0; k < NZ; k++) {
		const dth = (tgt.th0[k] - th0[k]) * r;
		const dqv = (tgt.qv0[k] - qv0[k]) * r;
		ub[k] = tgt.ub[k]; vb[k] = tgt.vb[k];
		if (Math.abs(dth) < 1e-7 && Math.abs(dqv) < 1e-10) continue;
		th0[k] += dth; qv0[k] += dqv; T0[k] = th0[k] * pi0[k];
		const o = sxy * k;
		for (let c = o; c < o + sxy; c++) {
			if (solid[c]) continue;
			TH[c] += dth;
			QV[c] = Math.max(0, QV[c] + dqv);
		}
	}
	// 大規模な上昇気流による冷却（層状の雲ができる）
	const wls = (params.wls || 0) / 100;
	if (wls !== 0) {
		for (let k = 1; k < NZ - 1; k++) {
			const z = zc[k];
			const shape = Math.sin(Math.PI * Math.min(1, z / (params.tropopause * 1000)));
			const dthdz = (th0[k + 1] - th0[k - 1]) / (2 * DZ);
			const d = -dt * wls * shape * dthdz;
			th0[k] += d; T0[k] = th0[k] * pi0[k];
			const o = sxy * k;
			for (let c = o; c < o + sxy; c++) if (!solid[c]) TH[c] += d;
		}
	}
}

function init(msg) {
	params = msg.params;
	NX = msg.nx; NY = msg.ny; NZ = msg.nz; LKM = msg.L; HKM = msg.H;
	DX = LKM * 1000 / NX; DY = LKM * 1000 / NY; DZ = HKM * 1000 / NZ;
	NC = NX * NY * NZ;
	fCor = 2 * 7.292e-5 * Math.sin(params.lat * Math.PI / 180);
	rng = mulberry32((Math.random() * 1e9) | 0);
	U = new Float32Array((NX + 1) * NY * NZ); U2 = new Float32Array(U.length);
	V = new Float32Array(NX * (NY + 1) * NZ); V2 = new Float32Array(V.length);
	W = new Float32Array(NX * NY * (NZ + 1)); W2 = new Float32Array(W.length);
	TH = new Float32Array(NC); QV = new Float32Array(NC); QC = new Float32Array(NC); QR = new Float32Array(NC);
	TH2 = new Float32Array(NC); QV2 = new Float32Array(NC); QC2 = new Float32Array(NC); QR2 = new Float32Array(NC);
	UC = new Float32Array(NC); VC = new Float32Array(NC); WC = new Float32Array(NC);
	PHI = new Float32Array(NC); DIV = new Float32Array(NC);
	solid = new Uint8Array(NC);
	const N2 = NX * NY;
	kg = new Int32Array(N2); hcell = new Float32Array(msg.heights); sea = new Uint8Array(msg.sea);
	Tg = new Float32Array(N2); soil = new Float32Array(N2); snow = new Float32Array(N2);
	rainRate = new Float32Array(N2); accum = new Float32Array(N2); charge = new Float32Array(N2);
	Ta2 = new Float32Array(N2); lwp = new Float32Array(N2); snowD = new Float32Array(N2);
	snaps = []; snapBytes = 0; ffTarget = -1;
	buildBase();
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		let h = hcell[c2];
		let k0 = 0;
		while (k0 < NZ - 6 && (k0 + 0.5) * DZ < h) k0++;
		kg[c2] = k0;
		for (let k = 0; k < k0; k++) solid[iC(i, j, k)] = 1;
		soil[c2] = sea[c2] ? 1 : params.soil;
		snow[c2] = (sea[c2] || params.snowInit <= 0) ? 0 : params.snowInit * Math.max(0, Math.min(1, (275 - baseTempAtHeight(h)) / 4));
		snowD[c2] = snow[c2] / SNOW_OLD_RHO; // 前から積もっている雪はしまっている
		// 過去 72 時間の雨（気象庁の降水ナウキャスト）：最近の雨ほど地面を湿らせ、寒い所では雪として積もっている
		if (msg.rain && !sea[c2]) {
			const wet = msg.rain.wet[c2], p72 = msg.rain.past72[c2];
			if (wet > 0.3) soil[c2] = Math.max(soil[c2], Math.min(1, 0.3 + wet / 25));
			const cold = Math.max(0, Math.min(1, (274.5 - baseTempAtHeight(h)) / 3));
			const add = p72 * 0.8 * cold;
			if (add > snow[c2]) { snowD[c2] += (add - snow[c2]) / 1.5; snow[c2] = add; }
		}
	}
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c = iC(i, j, k);
		TH[c] = th0[k] + (solid[c] ? 0 : (rng() - 0.5) * 0.2);
		QV[c] = qv0[k];
	}
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) U[iU(i, j, k)] = ub[k];
	for (let k = 0; k < NZ; k++) for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) V[iV(i, j, k)] = vb[k];
	obsRain = msg.rain && msg.rain.obs && msg.rain.obs.length > 1 ? msg.rain.obs : null;
	lsW = null; bQC = null; bQV = null; bQR = null;
	if (msg.cloud) buildOuter(msg.cloud);
	// 気象の再現から引き継いだ時点の雲と降水：高さ 1 km ごとの雲の濃さを格子へ補間して、雲水（と降っていれば雨粒・雪）を入れる
	if (msg.cloud) {
		const cl = msg.cloud, n = cl.n, nzc = cl.nz;
		const at = (A, i, j, k) => A[(Math.max(0, Math.min(n - 1, i)) + n * Math.max(0, Math.min(n - 1, j))) * nzc + k];
		const atP = (i, j) => cl.precip[Math.max(0, Math.min(n - 1, i)) + n * Math.max(0, Math.min(n - 1, j))];
		for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
			const c2 = i + NX * j;
			const fx = (i + 0.5) / NX * n - 0.5, fy = (j + 0.5) / NY * n - 0.5;
			const i0 = Math.floor(fx), j0 = Math.floor(fy), ax = fx - i0, ay = fy - j0;
			const bil = (k) => (at(cl.dens, i0, j0, k) * (1 - ax) + at(cl.dens, i0 + 1, j0, k) * ax) * (1 - ay) + (at(cl.dens, i0, j0 + 1, k) * (1 - ax) + at(cl.dens, i0 + 1, j0 + 1, k) * ax) * ay;
			const pr = (atP(i0, j0) * (1 - ax) + atP(i0 + 1, j0) * ax) * (1 - ay) + (atP(i0, j0 + 1) * (1 - ax) + atP(i0 + 1, j0 + 1) * ax) * ay;
			let top = 0;
			for (let k = kg[c2]; k < NZ; k++) {
				const z = zc[k] / 1000, kc = Math.min(nzc - 1, Math.max(0, Math.floor(z)));
				// 層の境目でなめらかに
				const fz = z - (kc + 0.5), kn = Math.min(nzc - 1, Math.max(0, kc + (fz > 0 ? 1 : -1)));
				let d = bil(kc) * (1 - Math.abs(fz)) + bil(kn) * Math.abs(fz);
				// 雲の中のむら（同じ濃さが一面に広がらないように）
				d *= 0.6 + 0.8 * rng();
				if (d < 0.08) continue;
				const c = iC(i, j, k);
				const T = TH[c] * pi0[k], qs = qsat(T, p0[k]);
				QV[c] = Math.max(QV[c], qs * Math.min(1, 0.97 + 0.03 * d));
				// 雲水：濃さ 1 でおよそ 0.25 g/kg（冷たい所は少なめ。多すぎると最初の数分で一気に雨になって減る）
				QC[c] = Math.max(QC[c], Math.min(6e-4, 2.5e-4 * d * (T < 253 ? 0.4 : 1)));
				if (zc[k] > top) top = zc[k];
			}
			// 降っている所は、雲の頂から地面まで雨粒（雪）がある状態から
			if (pr > 0.2 && top > 0) {
				for (let k = kg[c2]; k < NZ; k++) {
					if (zc[k] > top) break;
					const c = iC(i, j, k);
					QR[c] = Math.max(QR[c], Math.min(2e-3, 1.1e-4 * Math.sqrt(pr)));
				}
			}
		}
	}
	// いま雨が降っている所（降水ナウキャストの最新のコマ）は、雲の中が飽和し、雨粒がある状態から始める
	if (msg.rain) {
		for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
			const c2 = i + NX * j, r = msg.rain.now[c2];
			if (r < 0.4) continue;
			const top = Math.min(params.tropopause * 1000 * 0.8, 3500 + 900 * Math.sqrt(r));
			for (let k = kg[c2]; k < NZ; k++) {
				const z = zc[k]; if (z < hcell[c2] + 600 || z > top) continue;
				const c = iC(i, j, k);
				const T = TH[c] * pi0[k], qs = qsat(T, p0[k]);
				QV[c] = Math.max(QV[c], qs);
				QC[c] = Math.max(QC[c], Math.min(1e-3, 1.5e-4 * Math.sqrt(r)));
				QR[c] = Math.max(QR[c], Math.min(2e-3, 1e-4 * Math.sqrt(r)));
			}
		}
	}
	applyFaceMasks();
	buildOpenMasks();
	buildPoissonCoef();
	buildSponge();
	project(150);
	cellCenterVel();
	// 地表面温度の初期値
	const sinEl = sunInfo(0);
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		const k = kg[c2];
		const Tair = baseTempAtHeight(hcell[c2]);
		Tg[c2] = sea[c2] ? params.sst + 273.15 : Tair + Math.max(-3, 14 * Math.max(0, sinEl) - 2);
		if (!sea[c2] && snow[c2] > 0) Tg[c2] = Math.min(Tg[c2], 273.15);
		void k;
	}
	// 地上気温（最初の計算の前でも表示できるように）
	for (let c2 = 0; c2 < N2; c2++) { const k = kg[c2]; Ta2[c2] = TH[c2 + N2 * k] * pi0[k]; }
	simTime = 0; flashTotal = 0; flashRecent = []; flashes = [];
	saveSnapshot();
	publish();
}

function baseTempAtHeight(h) {
	const f = h / DZ - 0.5;
	if (f <= 0) return T0[0] + (0.5 * DZ - h) * params.lapse / 1000;
	const k = Math.min(NZ - 2, Math.floor(f));
	const t = Math.min(1, f - k);
	return T0[k] * (1 - t) + T0[k + 1] * t;
}

function applyFaceMasks() {
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) {
		const a = i > 0 ? solid[iC(i - 1, j, k)] : solid[iC(0, j, k)];
		const b = i < NX ? solid[iC(i, j, k)] : solid[iC(NX - 1, j, k)];
		if (a || b) U[iU(i, j, k)] = 0;
	}
	for (let k = 0; k < NZ; k++) for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) {
		const a = j > 0 ? solid[iC(i, j - 1, k)] : solid[iC(i, 0, k)];
		const b = j < NY ? solid[iC(i, j, k)] : solid[iC(i, NY - 1, k)];
		if (a || b) V[iV(i, j, k)] = 0;
	}
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		W[iW(i, j, 0)] = 0; W[iW(i, j, NZ)] = 0;
		for (let k = 1; k < NZ; k++) if (solid[iC(i, j, k - 1)] || solid[iC(i, j, k)]) W[iW(i, j, k)] = 0;
	}
}

// ---------- 補間 ----------
// 格子 arr（サイズ sx,sy,sz）を格子座標 (gx,gy,gz) で三線形補間
function samp(arr, sx, sy, sz, gx, gy, gz) {
	if (gx < 0) gx = 0; else if (gx > sx - 1) gx = sx - 1;
	if (gy < 0) gy = 0; else if (gy > sy - 1) gy = sy - 1;
	if (gz < 0) gz = 0; else if (gz > sz - 1) gz = sz - 1;
	let i0 = gx | 0, j0 = gy | 0, k0 = gz | 0;
	if (i0 >= sx - 1) i0 = sx - 2; if (j0 >= sy - 1) j0 = sy - 2; if (k0 >= sz - 1) k0 = sz - 2;
	if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (k0 < 0) k0 = 0;
	const fx = gx - i0, fy = gy - j0, fz = gz - k0;
	const sxy = sx * sy;
	const b = i0 + sx * j0 + sxy * k0;
	const c00 = arr[b] * (1 - fx) + arr[b + 1] * fx;
	const c10 = arr[b + sx] * (1 - fx) + arr[b + sx + 1] * fx;
	const c01 = arr[b + sxy] * (1 - fx) + arr[b + sxy + 1] * fx;
	const c11 = arr[b + sxy + sx] * (1 - fx) + arr[b + sxy + sx + 1] * fx;
	return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
}
// 物理座標 (m)
const sU = (x, y, z) => samp(U, NX + 1, NY, NZ, x / DX, y / DY - 0.5, z / DZ - 0.5);
const sV = (x, y, z) => samp(V, NX, NY + 1, NZ, x / DX - 0.5, y / DY, z / DZ - 0.5);
const sW = (x, y, z) => samp(W, NX, NY, NZ + 1, x / DX - 0.5, y / DY - 0.5, z / DZ);
const sC = (arr, x, y, z) => samp(arr, NX, NY, NZ, x / DX - 0.5, y / DY - 0.5, z / DZ - 0.5);

function cellCenterVel() {
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c = iC(i, j, k);
		UC[c] = 0.5 * (U[iU(i, j, k)] + U[iU(i + 1, j, k)]);
		VC[c] = 0.5 * (V[iV(i, j, k)] + V[iV(i, j + 1, k)]);
		WC[c] = 0.5 * (W[iW(i, j, k)] + W[iW(i, j, k + 1)]);
	}
}

// ---------- 移流 ----------
let uOpen, vOpen, wOpen;
function buildOpenMasks() {
	uOpen = new Uint8Array(U.length); vOpen = new Uint8Array(V.length); wOpen = new Uint8Array(W.length);
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) uOpen[iU(i, j, k)] = isUBlocked(i, j, k) ? 0 : 1;
	for (let k = 0; k < NZ; k++) for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) vOpen[iV(i, j, k)] = isVBlocked(i, j, k) ? 0 : 1;
	for (let k = 1; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) wOpen[iW(i, j, k)] = (solid[iC(i, j, k - 1)] || solid[iC(i, j, k)]) ? 0 : 1;
}
function advect(dt) {
	cellCenterVel();
	const sxU = NX + 1, sxyU = (NX + 1) * NY;
	const sxyV = NX * (NY + 1);
	const sxy = NX * NY;
	const idx = dt / DX, idy = dt / DY, idz = dt / DZ;
	// U 面：位置（格子座標）は U 格子で (i, j, k)
	for (let k = 0; k < NZ; k++) {
		const kp = Math.min(k + 1, NZ);
		for (let j = 0; j < NY; j++) {
			for (let i = 0; i <= NX; i++) {
				const id = i + sxU * (j + NY * k);
				if (!uOpen[id]) { U2[id] = 0; continue; }
				const ii = i < NX ? i : NX - 1, im = i > 0 ? i - 1 : 0;
				const v = 0.25 * (V[ii + NX * (j + (NY + 1) * k)] + V[ii + NX * (j + 1 + (NY + 1) * k)] + V[im + NX * (j + (NY + 1) * k)] + V[im + NX * (j + 1 + (NY + 1) * k)]);
				const w = 0.25 * (W[ii + NX * j + sxy * k] + W[ii + NX * j + sxy * kp] + W[im + NX * j + sxy * k] + W[im + NX * j + sxy * kp]);
				U2[id] = samp(U, sxU, NY, NZ, i - U[id] * idx, j - v * idy, k - w * idz);
			}
		}
	}
	for (let k = 0; k < NZ; k++) {
		const kp = Math.min(k + 1, NZ);
		for (let j = 0; j <= NY; j++) {
			const jj = j < NY ? j : NY - 1, jm = j > 0 ? j - 1 : 0;
			for (let i = 0; i < NX; i++) {
				const id = i + NX * (j + (NY + 1) * k);
				if (!vOpen[id]) { V2[id] = 0; continue; }
				const u = 0.25 * (U[i + sxU * (jj + NY * k)] + U[i + 1 + sxU * (jj + NY * k)] + U[i + sxU * (jm + NY * k)] + U[i + 1 + sxU * (jm + NY * k)]);
				const w = 0.25 * (W[i + NX * jj + sxy * k] + W[i + NX * jj + sxy * kp] + W[i + NX * jm + sxy * k] + W[i + NX * jm + sxy * kp]);
				V2[id] = samp(V, NX, NY + 1, NZ, i - u * idx, j - V[id] * idy, k - w * idz);
			}
		}
	}
	for (let k = 0; k <= NZ; k++) {
		const kk = k < NZ ? k : NZ - 1, km = k > 0 ? k - 1 : 0;
		for (let j = 0; j < NY; j++) {
			for (let i = 0; i < NX; i++) {
				const id = i + NX * j + sxy * k;
				if (!wOpen[id]) { W2[id] = 0; continue; }
				const u = 0.25 * (U[i + sxU * (j + NY * kk)] + U[i + 1 + sxU * (j + NY * kk)] + U[i + sxU * (j + NY * km)] + U[i + 1 + sxU * (j + NY * km)]);
				const v = 0.25 * (V[i + NX * (j + (NY + 1) * kk)] + V[i + NX * (j + 1 + (NY + 1) * kk)] + V[i + NX * (j + (NY + 1) * km)] + V[i + NX * (j + 1 + (NY + 1) * km)]);
				W2[id] = samp(W, NX, NY, NZ + 1, i - u * idx, j - v * idy, k - W[id] * idz);
			}
		}
	}
	// スカラー（重みを 1 回だけ計算して 4 つの量に使う）
	for (let k = 0; k < NZ; k++) {
		for (let j = 0; j < NY; j++) {
			for (let i = 0; i < NX; i++) {
				const c = i + NX * j + sxy * k;
				if (solid[c]) { TH2[c] = TH[c]; QV2[c] = QV[c]; QC2[c] = 0; QR2[c] = 0; continue; }
				let gx = i - UC[c] * idx, gy = j - VC[c] * idy, gz = k - WC[c] * idz;
				if (gx < 0) gx = 0; else if (gx > NX - 1) gx = NX - 1;
				if (gy < 0) gy = 0; else if (gy > NY - 1) gy = NY - 1;
				if (gz < 0) gz = 0; else if (gz > NZ - 1) gz = NZ - 1;
				let i0 = gx | 0, j0 = gy | 0, k0 = gz | 0;
				if (i0 > NX - 2) i0 = NX - 2; if (j0 > NY - 2) j0 = NY - 2; if (k0 > NZ - 2) k0 = NZ - 2;
				const fx = gx - i0, fy = gy - j0, fz = gz - k0;
				let th = 0, qv = 0, qc = 0, qr = 0, ws = 0;
				const b = i0 + NX * j0 + sxy * k0;
				for (let n = 0; n < 8; n++) {
					const di = n & 1, dj = (n >> 1) & 1, dk = n >> 2;
					const cc = b + di + NX * dj + sxy * dk;
					if (solid[cc]) continue;
					const w = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy) * (dk ? fz : 1 - fz);
					th += TH[cc] * w; qv += QV[cc] * w; qc += QC[cc] * w; qr += QR[cc] * w; ws += w;
				}
				if (ws > 1e-6) {
					const r = 1 / ws;
					TH2[c] = th * r; QV2[c] = qv * r; QC2[c] = qc * r; QR2[c] = qr * r;
				} else { TH2[c] = TH[c]; QV2[c] = QV[c]; QC2[c] = QC[c]; QR2[c] = QR[c]; }
			}
		}
	}
	let t;
	t = U; U = U2; U2 = t; t = V; V = V2; V2 = t; t = W; W = W2; W2 = t;
	t = TH; TH = TH2; TH2 = t; t = QV; QV = QV2; QV2 = t; t = QC; QC = QC2; QC2 = t; t = QR; QR = QR2; QR2 = t;
}

function isUBlocked(i, j, k) {
	const a = i > 0 ? solid[iC(i - 1, j, k)] : solid[iC(0, j, k)];
	const b = i < NX ? solid[iC(i, j, k)] : solid[iC(NX - 1, j, k)];
	return a || b;
}
function isVBlocked(i, j, k) {
	const a = j > 0 ? solid[iC(i, j - 1, k)] : solid[iC(i, 0, k)];
	const b = j < NY ? solid[iC(i, j, k)] : solid[iC(i, NY - 1, k)];
	return a || b;
}

// 地形セルを除いて補間（重み付き）
function sampFluid(arr, gx, gy, gz, fallback) {
	if (gx < 0) gx = 0; else if (gx > NX - 1) gx = NX - 1;
	if (gy < 0) gy = 0; else if (gy > NY - 1) gy = NY - 1;
	if (gz < 0) gz = 0; else if (gz > NZ - 1) gz = NZ - 1;
	let i0 = Math.min(NX - 2, gx | 0), j0 = Math.min(NY - 2, gy | 0), k0 = Math.min(NZ - 2, gz | 0);
	const fx = gx - i0, fy = gy - j0, fz = gz - k0;
	let sum = 0, ws = 0;
	for (let dk = 0; dk < 2; dk++) {
		const wz = dk ? fz : 1 - fz;
		for (let dj = 0; dj < 2; dj++) {
			const wy = dj ? fy : 1 - fy;
			for (let di = 0; di < 2; di++) {
				const c = (i0 + di) + NX * ((j0 + dj) + NY * (k0 + dk));
				if (solid[c]) continue;
				const w = (di ? fx : 1 - fx) * wy * wz;
				sum += arr[c] * w; ws += w;
			}
		}
	}
	return ws > 1e-6 ? sum / ws : fallback;
}

// ---------- 外力 ----------
let spU, spV, spC, spTopW, spTopC;
function buildSponge() {
	const S = Math.max(3, Math.round(NX / 12));
	const tauE = 400;
	const r = (d) => d < S ? Math.pow(1 - d / S, 2) / tauE : 0;
	spU = new Float32Array((NX + 1) * NY); spV = new Float32Array(NX * (NY + 1)); spC = new Float32Array(NX * NY);
	for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) spU[i + (NX + 1) * j] = r(Math.min(i, NX - i, j + 0.5, NY - 0.5 - j));
	for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) spV[i + NX * j] = r(Math.min(j, NY - j, i + 0.5, NX - 0.5 - i));
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) spC[i + NX * j] = r(Math.min(i + 0.5, NX - 0.5 - i, j + 0.5, NY - 0.5 - j));
	const KT = Math.max(3, Math.round(NZ / 6));
	spTopW = new Float32Array(NZ + 1); spTopC = new Float32Array(NZ);
	for (let k = NZ - KT; k <= NZ; k++) spTopW[k] = Math.pow((k - (NZ - KT)) / KT, 2) / 300;
	for (let k = NZ - KT; k < NZ; k++) spTopC[k] = Math.pow((k - (NZ - KT) + 1) / KT, 2) / 600;
}
function forces(dt) {
	// 浮力（W 面）
	for (let k = 1; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const a = iC(i, j, k - 1), b = iC(i, j, k);
		if (solid[a] || solid[b]) continue;
		const ba = G * ((TH[a] - th0[k - 1]) / th0[k - 1] + 0.608 * (QV[a] - qv0[k - 1]) - QC[a] - QR[a]);
		const bb = G * ((TH[b] - th0[k]) / th0[k] + 0.608 * (QV[b] - qv0[k]) - QC[b] - QR[b]);
		W[iW(i, j, k)] += dt * 0.5 * (ba + bb);
	}
	// コリオリ力（一般風からのずれに対して）と境界のスポンジ
	for (let k = 0; k < NZ; k++) {
		for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) {
			const id = iU(i, j, k);
			if (!uOpen[id]) continue;
			const ii = i < NX ? i : NX - 1, iim = i > 0 ? i - 1 : 0;
			const v = 0.25 * (V[iV(ii, j, k)] + V[iV(ii, j + 1, k)] + V[iV(iim, j, k)] + V[iV(iim, j + 1, k)]);
			U[id] += dt * fCor * (v - vb[k]);
			const r = spU[i + (NX + 1) * j];
			if (r > 0) U[id] += Math.min(1, dt * r) * (ub[k] - U[id]);
		}
		for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) {
			const id = iV(i, j, k);
			if (!vOpen[id]) continue;
			const jj = j < NY ? j : NY - 1, jjm = j > 0 ? j - 1 : 0;
			const u = 0.25 * (U[iU(i, jj, k)] + U[iU(i + 1, jj, k)] + U[iU(i, jjm, k)] + U[iU(i + 1, jjm, k)]);
			V[id] -= dt * fCor * (u - ub[k]);
			const r = spV[i + NX * j];
			if (r > 0) V[id] += Math.min(1, dt * r) * (vb[k] - V[id]);
		}
	}
	// 上端のスポンジ
	for (let k = 0; k <= NZ; k++) {
		if (!spTopW[k]) continue;
		const f = Math.min(1, dt * spTopW[k]);
		for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) W[iW(i, j, k)] *= (1 - f);
	}
	// スカラーのスポンジ
	for (let k = 0; k < NZ; k++) {
		const rTop = spTopC[k];
		for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
			const c = iC(i, j, k);
			if (solid[c]) continue;
			const r = rTop + spC[i + NX * j];
			if (r > 0) {
				const f = Math.min(1, dt * r);
				TH[c] += f * (th0[k] - TH[c]);
				// 縁は外の場（気象の再現の雲・湿り・雨）へ寄せる。上端と、外の場が無いときは雲なし
				if (bQC && !rTop) {
					QV[c] += f * (bQV[c] - QV[c]);
					QC[c] += f * (bQC[c] - QC[c]);
					QR[c] += f * 0.5 * (bQR[c] - QR[c]);
				} else {
					QV[c] += f * (qv0[k] - QV[c]);
					QC[c] -= f * QC[c];
					QR[c] -= f * QR[c] * 0.5;
				}
			}
		}
	}
	// 地表摩擦
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		const k = kg[c2];
		const cd = sea[c2] ? 1.2e-3 : 4e-3;
		const c = iC(i, j, k);
		const sp = Math.hypot(UC[c], VC[c]) + 0.5;
		const f = Math.min(0.5, dt * cd * sp / DZ);
		const iu1 = iU(i, j, k), iu2 = iU(i + 1, j, k);
		U[iu1] -= f * 0.5 * U[iu1]; U[iu2] -= f * 0.5 * U[iu2];
		const iv1 = iV(i, j, k), iv2 = iV(i, j + 1, k);
		V[iv1] -= f * 0.5 * V[iv1]; V[iv2] -= f * 0.5 * V[iv2];
	}
}

// ---------- 圧力の射影（鉛直方向のライン SOR）----------
let tri_a = new Float64Array(64), tri_b = new Float64Array(64), tri_c = new Float64Array(64), tri_d = new Float64Array(64);
let cXm, cXp, cYm, cYp, dH;
function buildPoissonCoef() {
	const ax = 1 / (DX * DX), ay = 1 / (DY * DY);
	cXm = new Float32Array(NC); cXp = new Float32Array(NC); cYm = new Float32Array(NC); cYp = new Float32Array(NC); dH = new Float32Array(NC);
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c = iC(i, j, k);
		if (solid[c]) continue;
		let d = 0;
		if (i > 0) { if (!solid[c - 1]) { d += ax; cXm[c] = ax; } } else d += ax;
		if (i < NX - 1) { if (!solid[c + 1]) { d += ax; cXp[c] = ax; } } else d += ax;
		if (j > 0) { if (!solid[c - NX]) { d += ay; cYm[c] = ay; } } else d += ay;
		if (j < NY - 1) { if (!solid[c + NX]) { d += ay; cYp[c] = ay; } } else d += ay;
		dH[c] = d;
	}
}
const cpA = new Float64Array(64), dpA = new Float64Array(64);
function project(iters) {
	const az = 1 / (DZ * DZ);
	const sxy = NX * NY;
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c = iC(i, j, k);
		if (solid[c]) { DIV[c] = 0; continue; }
		DIV[c] = (U[iU(i + 1, j, k)] - U[iU(i, j, k)]) / DX + (V[iV(i, j + 1, k)] - V[iV(i, j, k)]) / DY + (W[iW(i, j, k + 1)] - W[iW(i, j, k)]) / DZ;
	}
	const omega = 1.6;
	const N2 = NX * NY;
	for (let it = 0; it < iters; it++) {
		for (let color = 0; color < 2; color++) {
			for (let j = 0; j < NY; j++) for (let i = (j + color) & 1; i < NX; i += 2) {
				const c2 = i + NX * j;
				const k0 = kg[c2];
				const n = NZ - k0;
				const im = i > 0 ? -1 : 0, ip = i < NX - 1 ? 1 : 0, jm = j > 0 ? -NX : 0, jp = j < NY - 1 ? NX : 0;
				for (let kk = 0; kk < n; kk++) {
					const c = c2 + sxy * (k0 + kk);
					let diag = dH[c];
					const rhs = -DIV[c] + cXm[c] * PHI[c + im] + cXp[c] * PHI[c + ip] + cYm[c] * PHI[c + jm] + cYp[c] * PHI[c + jp];
					let lo = 0, up = 0;
					if (kk > 0) { diag += az; lo = -az; }
					if (kk < n - 1) { diag += az; up = -az; }
					tri_a[kk] = lo; tri_b[kk] = diag; tri_c[kk] = up; tri_d[kk] = rhs;
				}
				cpA[0] = tri_c[0] / tri_b[0]; dpA[0] = tri_d[0] / tri_b[0];
				for (let kk = 1; kk < n; kk++) {
					const m = 1 / (tri_b[kk] - tri_a[kk] * cpA[kk - 1]);
					cpA[kk] = tri_c[kk] * m;
					dpA[kk] = (tri_d[kk] - tri_a[kk] * dpA[kk - 1]) * m;
				}
				let x = dpA[n - 1];
				let c = c2 + sxy * (k0 + n - 1);
				PHI[c] += omega * (x - PHI[c]);
				for (let kk = n - 2; kk >= 0; kk--) {
					x = dpA[kk] - cpA[kk] * x;
					c = c2 + sxy * (k0 + kk);
					PHI[c] += omega * (x - PHI[c]);
				}
			}
		}
	}
	void N2;
	// 速度の補正 u -= ∇φ
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i <= NX; i++) {
		if (!uOpen[iU(i, j, k)]) continue;
		const pl = i > 0 ? PHI[iC(i - 1, j, k)] : 0;
		const pr = i < NX ? PHI[iC(i, j, k)] : 0;
		U[iU(i, j, k)] -= (pr - pl) / DX;
	}
	for (let k = 0; k < NZ; k++) for (let j = 0; j <= NY; j++) for (let i = 0; i < NX; i++) {
		if (!vOpen[iV(i, j, k)]) continue;
		const pl = j > 0 ? PHI[iC(i, j - 1, k)] : 0;
		const pr = j < NY ? PHI[iC(i, j, k)] : 0;
		V[iV(i, j, k)] -= (pr - pl) / DY;
	}
	for (let k = 1; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const a = iC(i, j, k - 1), b = iC(i, j, k);
		if (solid[a] || solid[b]) continue;
		W[iW(i, j, k)] -= (PHI[b] - PHI[a]) / DZ;
	}
}

// ---------- 雲物理と地表 ----------
function physics(dt) {
	const P = params;
	const sinEl = sunInfo(simTime);
	const solar = sinEl > 0 ? 1100 * Math.pow(sinEl, 1.15) * 0.78 : 0;
	const sst = P.sst + 273.15;
	// 列ごとの雲水量
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		let s = 0;
		for (let k = kg[i + NX * j]; k < NZ; k++) { const c = iC(i, j, k); s += (QC[c] + 0.2 * QR[c]) * rho0[k] * DZ; }
		lwp[i + NX * j] = s;
	}
	// 地表フラックス
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		const k = kg[c2];
		const c = iC(i, j, k);
		const Ta = TH[c] * pi0[k];
		const sp = Math.hypot(UC[c], VC[c]) + 1.5;
		const ps = p0[k];
		let Ts, qs, CH, CE;
		if (sea[c2]) {
			Ts = sst; qs = qsat(Ts, ps) * 0.98; CH = 1.3e-3; CE = 1.3e-3;
		} else {
			Ts = Tg[c2];
			const beta = snow[c2] > 0 ? 1 : 0.1 + 0.8 * soil[c2];
			qs = Math.max(QV[c], qsat(Ts, ps) * beta + QV[c] * (1 - beta));
			CH = 3.2e-3; CE = 3.2e-3;
		}
		const H = CH * sp * (Ts - Ta);            // K m/s
		const E = CE * sp * (qs - QV[c]);          // kg/kg m/s
		let dT = dt * H / DZ;
		const lim = 0.6 * Math.abs(Ts - Ta);
		if (dT > lim) dT = lim; else if (dT < -lim) dT = -lim;
		TH[c] += dT / pi0[k];
		let dq = dt * E / DZ;
		if (dq > 0) dq = Math.min(dq, Math.max(0, qsat(Ta, ps) * 1.02 - QV[c]));
		QV[c] = Math.max(0, QV[c] + dq);
		Ta2[c2] = Ta;
		// 地面の熱収支
		if (!sea[c2]) {
			const cloudT = Math.exp(-lwp[c2] * 9);
			const cloudi = 1 - Math.exp(-lwp[c2] * 25);
			const alb = snow[c2] > 0 ? 0.7 : 0.17 - 0.05 * soil[c2];
			const SW = (1 - alb) * solar * cloudT;
			const LW = (75 + 0.25 * (Ta - 273)) * (1 - 0.85 * cloudi) * (0.6 + 0.4 * (1 - P.rh / 100 * 0.6));
			const Hw = 1.2 * CP * H;
			const LE = LV * 1.2 * Math.max(0, E);
			const Td = baseTempAtHeight(hcell[c2]) + 1;
			const Gf = 6 * (Ts - Td);
			let dTg = dt * (SW - LW - Hw - LE - Gf) / 1.3e5;
			let Tn = Tg[c2] + dTg;
			if (snow[c2] > 0 && Tn > 273.15) {
				// 融雪
				const excess = (Tn - 273.15) * 1.3e5; // J/m2
				const melt = excess / 3.34e5;          // kg/m2 = mm
				const s0 = snow[c2];
				snow[c2] = Math.max(0, snow[c2] - melt);
				snowD[c2] *= s0 > 0 ? snow[c2] / s0 : 0;
				soil[c2] = Math.min(1, soil[c2] + melt / 20);
				Tn = 273.15;
			}
			Tg[c2] = Tn;
			// 夜、晴れて風の弱いときは地面近くの空気も放射で冷える（盆地や谷に冷気がたまり、霧・雲海になる）。
			// 一番下の格子は数百 m の厚さがあるので、地面だけ冷やしても空気が冷えきらないのを補う
			if (sinEl < 0.05) {
				const calm = 1 - Math.min(1, Math.max(0, (sp - 3.5) / 5));
				const clear = 1 - cloudi;
				if (calm > 0 && Ta > Tg[c2]) {
					const dTa = Math.min(Ta - Tg[c2], dt * 2.2 / 3600 * calm * clear);
					TH[c] -= dTa / pi0[k];
				}
			}
			// 乾燥
			soil[c2] = Math.max(0.05, soil[c2] - dt * (LE / LV) / 25);
		} else {
			Tg[c2] = sst;
		}
		// 対流のきっかけになる小さな揺らぎ
		if (Ts > Ta + 0.3) {
			const amp = Math.min(0.25, 0.04 * (Ts - Ta)) * Math.sqrt(dt / 20);
			TH[c] += (rng() - 0.5) * amp;
			if (k + 1 < NZ) TH[c + NX * NY] += (rng() - 0.5) * amp * 0.5;
		}
	}
	// 凝結・雨
	for (let k = 0; k < NZ; k++) {
		const pk = p0[k], pik = pi0[k], rk = rho0[k];
		const Lfac = LV / (CP * pik);
		for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
			const c = iC(i, j, k);
			if (solid[c]) continue;
			let th = TH[c], qv = QV[c], qc = QC[c], qr = QR[c];
			let T = th * pik;
			const qs = qsat(T, pk);
			// 飽和調節
			let d = (qv - qs) / (1 + LV * LV * qs / (CP * RV * T * T));
			if (d < -qc) d = -qc;
			// 冷たい雲（氷晶）はゆっくり昇華する
			if (d < 0 && T < 253) { const lim = -qc * Math.min(1, dt / (T < 238 ? 2400 : 900)); if (d < lim) d = lim; }
			qv -= d; qc += d; th += Lfac * d;
			T = th * pik;
			// 自動変換と捕捉（冷たい雲ではベルシェロン過程で早める）
			// -10〜-25℃ は氷晶が雪や霰に育ちやすい。もっと冷たい所の氷晶は小さくて落ちにくい（かなとこ雲・巻雲）
			const cold = T < 243 ? 0.12 : T < 263 ? 2.2 : T < 271 ? 1.5 : 1;
			const qc0 = T < 243 ? 4e-4 : T < 263 ? 2e-4 : 5e-4;
			let auto = 1.2e-3 * cold * Math.max(0, qc - qc0);
			let accr = (T < 243 ? 0.4 : 2.2) * qc * Math.pow(Math.max(qr, 0), 0.875);
			let conv = Math.min(qc, dt * (auto + accr));
			qc -= conv; qr += conv;
			// 雨の蒸発
			if (qr > 0 && qv < qs) {
				const rh = qv / qs;
				const rq = rk * qr;
				const ev = (1 - rh) * (1.6 + 124.9 * Math.pow(rq, 0.2046)) * Math.pow(rq, 0.525) / (5.4e5 + 2.55e6 / (pk * qs)) / rk;
				const e = Math.min(qr, dt * ev, Math.max(0, qs - qv));
				qr -= e; qv += e; th -= Lfac * e;
			}
			TH[c] = th; QV[c] = qv; QC[c] = qc; QR[c] = qr;
		}
	}
	// 落下（フラックス形式の風上差分）
	const vt = new Float32Array(NZ);
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		const k0 = kg[c2];
		let maxv = 0;
		for (let k = k0; k < NZ; k++) {
			const c = iC(i, j, k);
			const qr = QR[c];
			if (qr <= 1e-9) { vt[k] = 0; continue; }
			const T = TH[c] * pi0[k];
			const dens = Math.sqrt(1.15 / rho0[k]);
			const vr = 36.34 * Math.pow(rho0[k] * qr * 1e-3, 0.1346) * dens;
			let v;
			if (T >= 273.15) v = vr;
			else {
				const gf = Math.min(1, QC[c] * 1500) * (T > 248 ? 1 : 0.3); // 霰の割合
				v = (1.1 * (1 - gf) + 4.5 * gf) * dens;
				if (T < 275.5 && T > 273.15) v = vr * 0.7 + 1;
			}
			vt[k] = v; if (v > maxv) maxv = v;
		}
		const nsub = Math.max(1, Math.ceil(maxv * dt / (DZ * 0.8)));
		const sdt = dt / nsub;
		let ground = 0;
		for (let s = 0; s < nsub; s++) {
			let fluxAbove = 0;
			for (let k = NZ - 1; k >= k0; k--) {
				const c = iC(i, j, k);
				const out = rho0[k] * QR[c] * vt[k];
				QR[c] += sdt * (fluxAbove - out) / (rho0[k] * DZ);
				if (QR[c] < 0) QR[c] = 0;
				fluxAbove = out;
			}
			ground += fluxAbove * sdt;
		}
		const rate = ground / dt * 3600; // mm/h
		rainRate[c2] = rate;
		accum[c2] += ground;
		if (!sea[c2]) {
			if (Ta2[c2] < 274.4 && ground > 0) { snow[c2] += ground; snowD[c2] += ground / newSnowRho(Ta2[c2]); }
			else soil[c2] = Math.min(1, soil[c2] + ground / 20);
			// 雪は自分の重みでしまっていく
			if (snow[c2] > 0) {
				const dmin = snow[c2] / SNOW_SETTLED_RHO;
				if (snowD[c2] > dmin) snowD[c2] -= (snowD[c2] - dmin) * Math.min(1, dt / SNOW_SETTLE_TAU);
			} else snowD[c2] = 0;
		}
	}
	// 雷（混合相での霰・雲水・上昇流による電荷分離）
	flashes = [];
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		let s = 0, zs = 0, ws = 0, wmax = 0;
		for (let k = kg[c2]; k < NZ; k++) {
			const c = iC(i, j, k);
			const T = TH[c] * pi0[k];
			if (T > 268 || T < 243) continue;
			const w = WC[c];
			if (w > wmax) wmax = w;
			const v = QR[c] * 1000 * QC[c] * 1000 * Math.max(0, w);
			s += v; zs += v * zc[k]; ws += v;
		}
		charge[c2] = charge[c2] * Math.exp(-dt / 900) + dt * 0.0005 * s;
		if (charge[c2] > 1 && rng() < Math.min(1, dt / 10) * (charge[c2] - 0.8)) {
			const zq = ws > 0 ? zs / ws : 6000;
			const cg = rng() < 0.35;
			flashes.push({ x: (i + 0.5) / NX, y: (j + 0.5) / NY, z: zq / 1000, cg, t: simTime });
			flashTotal++;
			flashRecent.push(simTime);
			for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
				const ii = i + di, jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
				const f = Math.exp(-(di * di + dj * dj) / 6);
				charge[ii + NX * jj] *= 1 - 0.85 * f;
			}
		}
	}
	while (flashRecent.length && flashRecent[0] < simTime - 600) flashRecent.shift();
}

// 格子より小さい乱流による水平混合（積乱雲への周りの空気の取り込み）
let mixTmp = null;
function mixH(dt) {
	const a0 = Math.min(0.25, 0.04 * dt / 20);
	if (!mixTmp || mixTmp.length !== NC) mixTmp = new Float32Array(NC * 2);
	const t = mixTmp;
	// 雲の中と縁だけ混ぜる
	const wgt = t.subarray(NC);
	for (let c = 0; c < NC; c++) wgt[c] = QC[c] > 2e-5 ? Math.min(1, QC[c] / 3e-4) : 0;
	for (const F of [TH, QV, QC]) {
		for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
			const c = iC(i, j, k);
			if (solid[c]) { t[c] = F[c]; continue; }
			let s = 0, n = 0;
			if (i > 0 && !solid[c - 1]) { s += F[c - 1]; n++; }
			if (i < NX - 1 && !solid[c + 1]) { s += F[c + 1]; n++; }
			if (j > 0 && !solid[c - NX]) { s += F[c - NX]; n++; }
			if (j < NY - 1 && !solid[c + NX]) { s += F[c + NX]; n++; }
			let w = wgt[c];
			if (i > 0 && wgt[c - 1] > w) w = wgt[c - 1];
			if (i < NX - 1 && wgt[c + 1] > w) w = wgt[c + 1];
			if (j > 0 && wgt[c - NX] > w) w = wgt[c - NX];
			if (j < NY - 1 && wgt[c + NX] > w) w = wgt[c + NX];
			t[c] = n && w > 0 ? F[c] + a0 * w * (s - n * F[c]) / 4 : F[c];
		}
		F.set(t.subarray(0, NC));
	}
}

// ---------- 観測の雨の取り込み ----------
// 計算を過去の時刻から始めたときは、読み込んだ時刻（いま）までの気象庁の降水ナウキャストの雨を、
// 雨の降っている所の雲の中を湿らせて雲水・雨粒を足す形で、少しずつ取り込む（観測のない先は計算だけで進む）
let obsRain = null;
function assimilate(dt) {
	if (!obsRain) return;
	const last = obsRain[obsRain.length - 1];
	if (simTime > last.t + 1800) return; // 観測の時刻を過ぎた（巻き戻したらまた使う）
	let a = obsRain[0], b = obsRain[0];
	for (let i = 0; i < obsRain.length - 1; i++) if (obsRain[i].t <= simTime) { a = obsRain[i]; b = obsRain[i + 1]; }
	const f = b.t > a.t ? Math.max(0, Math.min(1, (simTime - a.t) / (b.t - a.t))) : 0;
	const r = Math.min(1, dt / 900);
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		const rate = a.rate[c2] * (1 - f) + b.rate[c2] * f;
		if (rate < 0.4 || rainRate[c2] > rate * 1.3) continue;
		const top = Math.min(params.tropopause * 1000 * 0.8, 3500 + 900 * Math.sqrt(rate));
		for (let k = kg[c2]; k < NZ; k++) {
			const z = zc[k]; if (z < hcell[c2] + 600 || z > top) continue;
			const c = iC(i, j, k);
			const qs = qsat(TH[c] * pi0[k], p0[k]);
			if (QV[c] < qs) QV[c] += (qs - QV[c]) * r;
			const qcT = Math.min(1e-3, 1.5e-4 * Math.sqrt(rate)), qrT = Math.min(2e-3, 1e-4 * Math.sqrt(rate));
			if (QC[c] < qcT) QC[c] += (qcT - QC[c]) * r;
			if (QR[c] < qrT) QR[c] += (qrT - QR[c]) * r;
		}
	}
}

// fast：早送り用の簡易計算（時間の刻みを長く、圧力の計算を少なく。細かい所は変わるが、雲や雨の育ち方はおおむね同じ）
function step(dt, fast) {
	advect(dt);
	mixH(dt);
	nudge(dt);
	largeScaleLift(dt);
	assimilate(dt);
	forces(dt);
	project(fast ? 6 : dt < 3 ? 5 : 10); // 前の結果から始めるので、少ない回数でも収束する
	cellCenterVel();
	physics(dt);
	simTime += dt;
	if (Math.floor(simTime / SNAP_EVERY) > Math.floor((simTime - dt) / SNAP_EVERY)) saveSnapshot();
}

// ---------- 出力 ----------
let pendingFlashes = [];
function publish() {
	const n = NC;
	const volA = new Uint8Array(n * 4);
	const volB = new Uint8Array(n * 4);
	const uc = new Float32Array(UC), vc = new Float32Array(VC), wc = new Float32Array(WC);
	let maxW = 0, maxWind = 0, cloudTop = 0, maxQc = 0;
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c = iC(i, j, k);
		const o = c * 4;
		if (solid[c]) {
			volA[o] = 0; volA[o + 1] = 0; volA[o + 2] = clamp255((T0[k] + 6 - 193) / 120 * 255); volA[o + 3] = 128;
			volB[o] = 128; volB[o + 1] = 0; volB[o + 2] = 128; volB[o + 3] = 0;
			continue;
		}
		const T = TH[c] * pi0[k];
		const qs = qsat(T, p0[k]);
		const qcg = QC[c] * 1000, qrg = QR[c] * 1000;
		// 巻雲などの冷たい雲は氷の量がごく少ない（0.001〜0.03 g/kg）が、粒が小さく光をよく散らすので、表示では濃くする
		const qcv = T < 248 ? Math.min(qcg * 14, Math.max(qcg, 0.12)) : qcg;
		volA[o] = clamp255(Math.sqrt(qcv / 3) * 255);
		volA[o + 1] = clamp255(Math.sqrt(qrg / 6) * 255);
		volA[o + 2] = clamp255((T - 193) / 120 * 255);
		volA[o + 3] = clamp255(Math.min(1, QV[c] / qs) * 255);
		const dth = TH[c] - th0[k];
		const sp = Math.hypot(UC[c], VC[c], WC[c]);
		volB[o] = clamp255(128 + dth / 12 * 127);
		volB[o + 1] = clamp255(sp / 60 * 255);
		volB[o + 2] = clamp255(128 + WC[c] / 20 * 127);
		volB[o + 3] = 0;
		if (WC[c] > maxW) maxW = WC[c];
		if (sp > maxWind) maxWind = sp;
		if (QC[c] > (T < 248 ? 3e-6 : 1e-4) && zc[k] > cloudTop) cloudTop = zc[k];
		if (QC[c] > maxQc) maxQc = QC[c];
	}
	// 雲の種類を判定し、見た目の質感（対流性か層状か）を volB.a に入れる
	const cloudLabels = classifyClouds(volB, volA);
	// 表示用に雲を水平方向に少しぼかす（格子の角ばりを目立たなくする）
	blurCloud(volA);
	const N2 = NX * NY;
	const surfA = new Uint8Array(N2 * 4), surfB = new Uint8Array(N2 * 4);
	let maxRain = 0, sumRain = 0, maxAcc = 0, cover = 0;
	for (let c2 = 0; c2 < N2; c2++) {
		const o = c2 * 4;
		surfA[o] = clamp255(Math.sqrt(rainRate[c2] / 100) * 255);
		surfA[o + 1] = clamp255(Math.sqrt(accum[c2] / 400) * 255);
		surfA[o + 2] = clamp255(Math.sqrt(snow[c2] / 300) * 255);
		surfA[o + 3] = clamp255((Ta2[c2] - 233.15) / 80 * 255);
		surfB[o] = clamp255(soil[c2] * 255);
		surfB[o + 1] = clamp255((Tg[c2] - 233.15) / 100 * 255);
		surfB[o + 2] = clamp255(charge[c2] * 200);
		surfB[o + 3] = clamp255(Math.sqrt(snowD[c2] / 400) * 255); // 積雪の深さ（cm）
		if (rainRate[c2] > maxRain) maxRain = rainRate[c2];
		if (accum[c2] > maxAcc) maxAcc = accum[c2];
		sumRain += rainRate[c2];
		if (lwp[c2] > 0.02) cover++;
	}
	const sfc = {
		rain: new Float32Array(rainRate), accum: new Float32Array(accum), snow: new Float32Array(snow), snowD: new Float32Array(snowD),
		ta: new Float32Array(Ta2), tg: new Float32Array(Tg), kg: new Int32Array(kg),
	};
	let maxSnowD = 0;
	for (let c2 = 0; c2 < N2; c2++) if (snowD[c2] > maxSnowD) maxSnowD = snowD[c2];
	const qv = new Float32Array(QV), th = new Float32Array(TH), qcA = new Float32Array(QC), qrA = new Float32Array(QR);
	const out = {
		type: 'state', gen: GEN, simTime,
		volA, volB, surfA, surfB, uc, vc, wc, qv, th, qc: qcA, qr: qrA, sfc,
		base: { p0: Array.from(p0), pi0: Array.from(pi0), th0: Array.from(th0) },
		flashes: pendingFlashes, cloudLabels,
		stats: {
			maxW, maxWind, cloudTop, maxRain, maxAcc, meanRain: sumRain / N2, cover: cover / N2,
			flashTotal, flash10: flashRecent.length, sun: sunInfo(simTime), maxSnowD,
		},
		snaps: snaps.map((s) => s.simTime), ff: ffTarget >= 0 ? ffTarget : null,
	};
	pendingFlashes = [];
	self.postMessage(out, [volA.buffer, volB.buffer, surfA.buffer, surfB.buffer, uc.buffer, vc.buffer, wc.buffer,
		qv.buffer, th.buffer, qcA.buffer, qrA.buffer, sfc.rain.buffer, sfc.accum.buffer, sfc.snow.buffer, sfc.snowD.buffer, sfc.ta.buffer, sfc.tg.buffer, sfc.kg.buffer]);
}

// ---------- 巻き戻し用の保存点 ----------
// 模擬時間で 30 分ごとに計算の状態をまるごと写しておく。合計がおよそ 120 MB を超えたら、
// 間隔がいちばん詰まっている所から間引く（最初と最新は残す）。
const SNAP_EVERY = 1800, SNAP_LIMIT = 120 * 1024 * 1024;
let snaps = [], snapBytes = 0, ffTarget = -1;
const SNAP_KEYS = ['U', 'V', 'W', 'TH', 'QV', 'QC', 'QR', 'PHI', 'Tg', 'soil', 'snow', 'snowD', 'rainRate', 'accum', 'charge', 'Ta2', 'th0', 'qv0', 'T0', 'ub', 'vb'];
function getArr(k) {
	switch (k) {
		case 'U': return U; case 'V': return V; case 'W': return W; case 'TH': return TH; case 'QV': return QV; case 'QC': return QC; case 'QR': return QR; case 'PHI': return PHI;
		case 'Tg': return Tg; case 'soil': return soil; case 'snow': return snow; case 'snowD': return snowD; case 'rainRate': return rainRate; case 'accum': return accum;
		case 'charge': return charge; case 'Ta2': return Ta2; case 'th0': return th0; case 'qv0': return qv0; case 'T0': return T0; case 'ub': return ub; case 'vb': return vb;
	}
	return null;
}
function saveSnapshot() {
	return; // 組み込み版では保存点を作らない
	if (snaps.length && snaps[snaps.length - 1].simTime >= simTime - 1) return;
	const s = { simTime, flashTotal, params: JSON.parse(JSON.stringify(params)), nudgeTau, arrs: {}, bytes: 0 };
	for (const k of SNAP_KEYS) { const a = getArr(k); s.arrs[k] = a.slice(); s.bytes += a.byteLength; }
	s.tgt = { th0: tgt.th0.slice(), qv0: tgt.qv0.slice(), ub: tgt.ub.slice(), vb: tgt.vb.slice(), T0: tgt.T0.slice() };
	snaps.push(s); snapBytes += s.bytes;
	while (snapBytes > SNAP_LIMIT && snaps.length > 3) {
		let best = 1, bestGap = Infinity;
		for (let i = 1; i < snaps.length - 1; i++) {
			const gap = snaps[i + 1].simTime - snaps[i - 1].simTime;
			if (gap < bestGap) { bestGap = gap; best = i; }
		}
		snapBytes -= snaps[best].bytes;
		snaps.splice(best, 1);
	}
}
// 時刻 t 以前でいちばん近い保存点から計算し直す（t まで早送りする）
function restoreTo(t) {
	if (!snaps.length) return false;
	let s = snaps[0];
	for (const q of snaps) if (q.simTime <= t + 1) s = q;
	for (const k of SNAP_KEYS) getArr(k).set(s.arrs[k]);
	tgt.th0.set(s.tgt.th0); tgt.qv0.set(s.tgt.qv0); tgt.ub.set(s.tgt.ub); tgt.vb.set(s.tgt.vb); tgt.T0.set(s.tgt.T0);
	params = JSON.parse(JSON.stringify(s.params));
	nudgeTau = s.nudgeTau;
	simTime = s.simTime; flashTotal = s.flashTotal; flashRecent = []; flashes = []; pendingFlashes = [];
	// この先の保存点は計算し直すので捨てる
	while (snaps.length && snaps[snaps.length - 1].simTime > simTime + 1) snapBytes -= snaps.pop().bytes;
	cellCenterVel();
	ffTarget = t > simTime + 1 ? t : -1;
	debt = 0;
	return true;
}
// ---------- 雲の種類（十種雲形と山の雲）----------
// 列ごとに雲の層を探し、底と頂の高さ・厚さ・上昇流・温度・地形から種類を決める
function classifyClouds(volB, volA) {
	const labels = [];
	const BIN = Math.max(4, Math.round(NX / 8));
	const seen = new Map();
	const sxy = NX * NY;
	// 雲とみなす量（冷たい雲は氷の量が少ないので低く）
	const thrK = new Float32Array(NZ);
	for (let k = 0; k < NZ; k++) thrK[k] = T0[k] < 248 ? 2e-6 : 2e-5;
	for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c2 = i + NX * j;
		const h = hcell[c2];
		let k = kg[c2];
		while (k < NZ) {
			if (QC[c2 + sxy * k] < thrK[k]) { k++; continue; }
			const kb = k;
			let wmax = 0, qr = 0, qcs = 0;
			while (k < NZ && QC[c2 + sxy * k] >= thrK[k]) {
				const c = c2 + sxy * k;
				if (Math.abs(WC[c]) > wmax) wmax = Math.abs(WC[c]);
				qcs += QC[c];
				k++;
			}
			const kt = k - 1;
			qr = QR[c2 + sxy * kb];
			const zb = kb * DZ, zt = (kt + 1) * DZ, thick = zt - zb;
			const Ttop = TH[c2 + sxy * kt] * pi0[kt];
			const hb = zb - h;
			// 周りの地形
			let hmax = 0, hmax2 = 0, pkD = 99;
			for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
				const ii = i + di, jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
				const hh = hcell[ii + NX * jj];
				if (hh > hmax) { hmax = hh; pkD = Math.hypot(di, dj); }
				if (Math.abs(di) <= 2 && Math.abs(dj) <= 2 && hh > hmax2) hmax2 = hh;
			}
			// 山頂付近：いちばん高い所から 3 マス以内で、雲が山頂の高さを包んでいる（山頂にかぶさる笠）
			const peak = (h >= hmax2 - 200 && h >= hmax - 400) || (pkD <= 3 && zt >= hmax - 150 && zb <= hmax + 400 && h >= hmax - 1200);
			// 周りにも同じ高さの雲が広がっているか（広がっていれば層状の雲で、笠雲・つるし雲ではない）
			const kmid = Math.min(NZ - 1, Math.round((kb + kt) / 2));
			let nCl = 0, nAll = 0;
			for (let dj = -5; dj <= 5; dj += 1) for (let di = -5; di <= 5; di += 1) {
				const ii = i + di, jj = j + dj;
				if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
				nAll++;
				if (QC[ii + NX * jj + sxy * kmid] >= thrK[kmid]) nCl++;
			}
			const isolated = nCl < nAll * 0.45;
			const wsp = Math.hypot(UC[c2 + sxy * kmid], VC[c2 + sxy * kmid]);
			const kk = Math.min(NZ - 2, Math.max(1, Math.round((kb + kt) / 2)));
			const stab = (th0[kk + 1] - th0[kk - 1]) / (2 * DZ) * 1000; // K/km
			let type;
			const conv = wmax > 1.8;
			if (thick >= 5500 && wmax > 4 && Ttop < 248) type = 'Cb';
			else if (conv && zb < 3500) type = thick > 2800 ? 'TCu' : 'Cu';
			else if (hb < 350 && zt < hmax - 250 && thick < 1600 && zb < 2200) type = 'Unkai';
			else if (peak && hmax > 1500 && zb - hmax < 500 && thick < 2000 && !conv && stab > 2.5 && isolated && wsp > 6) type = 'Kasa';
			else if (thick <= 1300 && hb > 700 && hmax > 1200 && stab > 3 && zb < 7000 && !conv && isolated && wsp > 8) type = 'Lenti';
			else if (hb < 350) type = h > 600 ? 'Gas' : 'Fog';
			else if (zb < 2000) {
				if (thick > 3000 && qr > 5e-5) type = 'Ns';
				else if (hb < 600 && thick < 1500) type = 'St';
				else type = 'Sc';
			} else if (zb < 6000 && Ttop > 236) {
				if (thick > 3500 && qr > 5e-5 && zb < 3200) type = 'Ns';
				else type = thick > 2200 ? 'As' : 'Ac';
			} else {
				type = thick > 1600 ? 'Cs' : (wmax > 0.6 ? 'Cc' : 'Ci');
			}
			// 質感：0＝層状（なめらか）、1＝対流性（もくもく）、0.15＝笠雲・つるし雲（つるり）
			const style = type === 'Cb' || type === 'TCu' || type === 'Cu' ? Math.min(1, 0.55 + wmax / 8)
				: type === 'Kasa' || type === 'Lenti' ? 0.12
				: type === 'Sc' || type === 'Ac' || type === 'Cc' ? 0.45
				: type === 'Ci' ? 0.3 : 0.2;
			const sv = clamp255(style * 255);
			for (let q = kb; q <= kt; q++) volB[(c2 + sxy * q) * 4 + 3] = sv;
			// 笠雲・つるし雲は薄くても白くくっきり見えるので、表示を濃くする
			if (volA && (type === 'Kasa' || type === 'Lenti')) for (let q = kb; q <= kt; q++) { const o = (c2 + sxy * q) * 4; volA[o] = clamp255(volA[o] * 1.5 + 40); }
			// 代表点（同じ種類は格子のまとまりごとに 1 つ）
			const key = type + ':' + Math.floor(i / BIN) + ':' + Math.floor(j / BIN);
			const score = qcs * (type === 'Cb' ? 3 : 1);
			const prev = seen.get(key);
			if (!prev || prev.score < score) {
				const lab = { type, x: (i + 0.5) / NX, y: (j + 0.5) / NY, zb: zb / 1000, zt: zt / 1000, score };
				if (prev) labels[prev.idx] = lab; else { seen.set(key, { score, idx: labels.length }); labels.push(lab); continue; }
				seen.set(key, { score, idx: prev.idx });
			}
		}
	}
	labels.sort((a, b) => b.score - a.score);
	return labels.slice(0, 60).map(({ type, x, y, zb, zt }) => ({ type, x, y, zb, zt }));
}

let blurTmp = null;
function blurCloud(vol) {
	if (!blurTmp || blurTmp.length !== NC) blurTmp = new Float32Array(NC);
	const t = blurTmp;
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c = iC(i, j, k);
		const a = vol[(i > 0 ? c - 1 : c) * 4], b = vol[c * 4], d = vol[(i < NX - 1 ? c + 1 : c) * 4];
		t[c] = Math.max(b, 0.25 * a + 0.5 * b + 0.25 * d);
	}
	for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
		const c = iC(i, j, k);
		const a = t[j > 0 ? c - NX : c], b = t[c], d = t[j < NY - 1 ? c + NX : c];
		vol[c * 4] = Math.max(vol[c * 4], (0.25 * a + 0.5 * b + 0.25 * d) | 0);
	}
}
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

// ---------- ループ ----------
let lastReal = 0, debt = 0, lastPub = 0, timer = null, stepCost = 20;
function tick() {
	timer = null;
	if (!params) return;
	const now = performance.now();
	const el = Math.min(0.5, (now - lastReal) / 1000);
	lastReal = now;
	if (ffTarget >= 0) {
		// 時間のつまみで先へ飛んだとき・巻き戻したあと：目標の時刻まで、簡易計算でできるだけ速く進める
		const t0 = performance.now();
		while (simTime < ffTarget - 0.5 && performance.now() - t0 < 80) {
			const rest = ffTarget - simTime;
			step(Math.min(rest > 1800 ? 60 : DTMAX, rest), rest > 1800); // 目標の 30 分前からはふつうの計算に戻す
			flashes = [];
		}
		if (simTime >= ffTarget - 0.5) ffTarget = -1;
		if (ffTarget < 0 || performance.now() - lastPub > 250) { publish(); lastPub = performance.now(); }
		timer = setTimeout(tick, 2);
		return;
	}
	if (running) {
		debt += el * speed;
		// 追いつけない分は捨てる（実際の速さは表示で知らせる）
		const maxDebt = Math.max(DTMAX * 2, speed * 0.6);
		if (debt > maxDebt) debt = maxDebt;
		const minDt = Math.min(DTMAX, Math.max(0.3, speed * 0.08));
		const t0 = performance.now();
		let did = false;
		while (debt >= minDt && performance.now() - t0 < 60) {
			const nSteps = Math.ceil(debt / DTMAX);
			const dt = Math.min(DTMAX, debt / nSteps);
			const s0 = performance.now();
			step(dt);
			stepCost = stepCost * 0.8 + (performance.now() - s0) * 0.2;
			debt -= dt;
			did = true;
			if (flashes.length) pendingFlashes.push(...flashes);
			if (debt < minDt) break;
		}
		if (did && performance.now() - lastPub > Math.max(70, Math.min(250, stepCost * 2.5))) { publish(); lastPub = performance.now(); }
	}
	timer = setTimeout(tick, running ? 2 : 50);
}

let GEN = 0; // 何回目の計算か（前の計算の状態が後から届いても、画面側で捨てられるように）
self.onmessage = (e) => {
	const m = e.data;
	if (m.type === 'init') {
		GEN = m.gen || 0;
		init(m);
		running = m.running;
		speed = m.speed;
		lastReal = performance.now(); debt = 0;
		if (!timer) tick();
	} else if (m.type === 'speed') {
		speed = m.speed;
	} else if (m.type === 'run') {
		running = m.running;
		lastReal = performance.now();
	} else if (m.type === 'outer') {
		// 気象の再現の外の場を新しい時刻のものに
		if (NX && m.cloud) buildOuter(m.cloud);
	} else if (m.type === 'live' || m.type === 'nudge') {
		// 風や海面水温（live）、広域モードや台本からの条件（nudge）をその場で変える
		Object.assign(params, m.params);
		if (m.tau) nudgeTau = m.tau;
		if (NX) tgt = computeBase(params);
	} else if (m.type === 'restore') {
		// 時間のつまみで戻したとき
		// 今より先なら、保存点に戻さずにそのまま早送り
		if (NX && m.t > simTime + 1) { ffTarget = m.t; debt = 0; publish(); lastPub = performance.now(); if (!timer) tick(); }
		else if (NX && restoreTo(m.t)) {
			publish(); lastPub = performance.now();
			if (!timer) tick();
		}
	} else if (m.type === 'stepOnce') {
		step(Math.min(DTMAX, m.dt || DTMAX));
		publish();
	}
};
