import type { AnalysisInfo, BuildAssets, BuildName, PikafishEngine } from 'pikafish-js';
import { createEngine } from 'pikafish-js';
import engineWorkerUrl from 'pikafish-js/engine.worker.js?url';

export type EnginePhase = 'idle' | 'loading' | 'ready' | 'error';

export interface EngineState {
  phase: EnginePhase;
  message: string;
  progress: number;
}

export interface AnalysisSnapshot {
  bestmove: string | null;
  lines: AnalysisInfo[];
  elapsedMs: number;
}

const builds: Partial<Record<BuildName, BuildAssets>> = {
  'threads-simd': {
    js: '/engine/w256-threads-simd.pikafish.js',
    wasm: '/engine/w256-threads-simd.pikafish.wasm',
  },
  'single-simd': {
    js: '/engine/w256-single-simd.pikafish.js',
    wasm: '/engine/w256-single-simd.pikafish.wasm',
  },
  'single-nosimd': {
    js: '/engine/w256-single-nosimd.pikafish.js',
    wasm: '/engine/w256-single-nosimd.pikafish.wasm',
  },
};

let engine: PikafishEngine | null = null;
let initPromise: Promise<PikafishEngine> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let state: EngineState = { phase: 'idle', message: '等待启动', progress: 0 };
const listeners = new Set<(next: EngineState) => void>();

function publish(next: EngineState): void {
  state = next;
  listeners.forEach((listener) => listener(next));
}

export function getEngineState(): EngineState {
  return state;
}

export function subscribeEngine(listener: (next: EngineState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function initializeEngine(): Promise<PikafishEngine> {
  if (engine) return Promise.resolve(engine);
  if (initPromise) return initPromise;

  publish({ phase: 'loading', message: '正在加载皮卡鱼', progress: 0.04 });
  initPromise = createEngine({
    build: 'auto',
    builds,
    netUrl: '/engine/pikafish-w256.nnue',
    netSha256: '316da3939d66edacc730a313a1bdddb0619ad1b8158b1dc5bd8244af335c552b',
    threads: Math.min(4, Math.max(1, navigator.hardwareConcurrency || 2)),
    hashMB: 32,
    multiPV: 3,
    workerFactory: () => new Worker(engineWorkerUrl, { type: 'classic', name: 'yijian-pikafish' }),
    onNetProgress: ({ loaded, total, cached }) => {
      const progress = total ? Math.min(0.92, loaded / total) : 0.18;
      publish({
        phase: 'loading',
        message: cached ? '正在读取本地引擎' : '首次加载分析网络',
        progress,
      });
    },
  })
    .then((instance) => {
      engine = instance;
      const build = instance.info?.build ?? instance.build;
      publish({ phase: 'ready', message: `皮卡鱼已就绪 · ${build}`, progress: 1 });
      return instance;
    })
    .catch((error: unknown) => {
      initPromise = null;
      const message = error instanceof Error ? error.message : '引擎加载失败';
      publish({ phase: 'error', message, progress: 0 });
      throw error;
    });

  return initPromise;
}

async function analyzeNow(
  fen: string,
  options: { movetime?: number; depth?: number; multiPV?: number } = {},
): Promise<AnalysisSnapshot> {
  const instance = await initializeEngine();
  const rows = new Map<number, AnalysisInfo>();
  const handle = await instance.analyze({
    fen,
    movetime: options.movetime ?? 700,
    depth: options.depth,
    multiPV: options.multiPV ?? 3,
  });
  for await (const info of handle.updates) {
    rows.set(info.multipv ?? 1, info);
  }
  const result = await handle.result;
  return {
    bestmove: result.bestmove === '(none)' ? null : result.bestmove,
    lines: [...rows.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]),
    elapsedMs: result.elapsedMs,
  };
}

export function analyzePosition(
  fen: string,
  options?: { movetime?: number; depth?: number; multiPV?: number },
): Promise<AnalysisSnapshot> {
  const task = queue.then(() => analyzeNow(fen, options));
  queue = task.catch(() => undefined);
  return task;
}
