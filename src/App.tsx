import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FlipVertical2,
  Lightbulb,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  Game,
  PIECE_NAMES,
  applyMove,
  generateLegalMoves,
  moveToUcci,
  parseUcci,
  pieceAt,
  toChineseNotation,
  type Color,
  type Move,
  type Position,
  type Square,
} from '@pikafish-js/rules';
import type { AnalysisInfo } from 'pikafish-js';
import { analyzePosition, getEngineState, initializeEngine, subscribeEngine, type AnalysisSnapshot, type EngineState } from './engine';
import { buildCoachFeedback, type CoachFeedback } from './coach';
import { parseRecord, SAMPLE_RECORD, type ParsedRecord } from './notation';

type Mode = 'study' | 'play';
type Difficulty = '入门' | '进阶' | '高手';

const DIFFICULTY: Record<Difficulty, number> = { 入门: 280, 进阶: 650, 高手: 1200 };
const PIECE_VALUE: Record<string, number> = { k: 10000, r: 900, c: 450, n: 400, b: 220, a: 220, p: 100 };

interface StudyLine extends ParsedRecord {
  name: string;
}

function sameSquare(a: Square, b: Square): boolean {
  return a.file === b.file && a.rank === b.rank;
}

function scoreLabel(info?: AnalysisInfo): string {
  if (!info?.score) return '--';
  if (info.score.type === 'mate') return info.score.value > 0 ? `杀 ${Math.abs(info.score.value)}` : `被杀 ${Math.abs(info.score.value)}`;
  const value = info.score.value / 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function pvToChinese(position: Position, pv?: string[]): string {
  if (!pv?.length) return '计算中';
  const labels: string[] = [];
  let current = position;
  for (const text of pv.slice(0, 7)) {
    const move = parseUcci(text);
    if (!move || !generateLegalMoves(current).some((candidate) => moveToUcci(candidate) === text)) break;
    labels.push(toChineseNotation(current, move));
    current = applyMove(current, move);
  }
  return labels.join(' ');
}

function fallbackMove(game: Game): Move | null {
  const moves = game.legalMoves();
  if (!moves.length) return null;
  const captures = moves
    .map((move) => ({ move, target: pieceAt(game.position.board, move.to) }))
    .filter((entry) => entry.target)
    .sort((a, b) => PIECE_VALUE[b.target!.type] - PIECE_VALUE[a.target!.type]);
  return captures[0]?.move ?? moves[Math.floor(Math.random() * moves.length)] ?? null;
}

function App() {
  const gameRef = useRef(new Game());
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<Mode>('study');
  const [selected, setSelected] = useState<Square | null>(null);
  const [targets, setTargets] = useState<Move[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState('');
  const [playerColor, setPlayerColor] = useState<Color>('w');
  const [difficulty, setDifficulty] = useState<Difficulty>('进阶');
  const [feedback, setFeedback] = useState<CoachFeedback | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null);
  const [analysisPosition, setAnalysisPosition] = useState<Position | null>(null);
  const [engineState, setEngineState] = useState<EngineState>(getEngineState());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState(SAMPLE_RECORD);
  const [importError, setImportError] = useState('');
  const [studyLine, setStudyLine] = useState<StudyLine>(() => ({ name: '橘中秘 · 顺炮片段', ...parseRecord(SAMPLE_RECORD) }));
  const game = gameRef.current;
  const status = game.status();

  useEffect(() => subscribeEngine(setEngineState), []);
  useEffect(() => {
    void initializeEngine().catch(() => undefined);
  }, []);

  const expectedIndex = game.history.length;
  const expectedLabel = studyLine.labels[expectedIndex] ?? null;
  const canUserMove = !busy && !status.over && (mode === 'study' || game.turn === playerColor);

  function clearSelection(): void {
    setSelected(null);
    setTargets([]);
  }

  function refresh(): void {
    setRevision((value) => value + 1);
  }

  function reset(nextMode = mode): void {
    gameRef.current = new Game();
    setMode(nextMode);
    setFeedback(null);
    setAnalysis(null);
    setAnalysisPosition(null);
    setBusy('');
    clearSelection();
    setRevision((value) => value + 1);
  }

  function onSquare(square: Square): void {
    if (!canUserMove) return;
    if (selected) {
      const move = targets.find((candidate) => sameSquare(candidate.to, square));
      if (move) {
        void commitUserMove(move);
        return;
      }
    }
    const piece = pieceAt(game.position.board, square);
    if (piece?.color === game.turn) {
      setSelected(square);
      setTargets(game.legalMovesFrom(square));
    } else {
      clearSelection();
    }
  }

  async function commitUserMove(move: Move): Promise<void> {
    const currentGame = gameRef.current;
    const before = currentGame.position;
    const beforeFen = currentGame.fen;
    const moveIndex = currentGame.history.length;
    const expectedUcci = studyLine.moves[moveIndex];
    const expectedMove = expectedUcci ? parseUcci(expectedUcci) : null;
    const followedLine = mode !== 'study' || !expectedUcci || expectedUcci === moveToUcci(move);

    currentGame.move(move);
    clearSelection();
    refresh();
    setAnalysis(null);
    setFeedback(null);

    if (mode === 'study' && !followedLine) {
      const expectedNotation = expectedMove ? toChineseNotation(before, expectedMove) : '谱招';
      setFeedback({
        tone: 'mistake',
        label: '偏离棋谱',
        title: `${toChineseNotation(before, move)} 不是本回合谱招`,
        summary: `原谱选择 ${expectedNotation}。这通常意味着当前复盘线中的战略目标还没有完成。`,
        detail: '可以查看引擎差异，也可以直接回到谱招继续打谱。',
        bestMove: expectedMove,
        bestNotation: expectedNotation,
        loss: 0,
        variation: '',
      });
    } else if (mode === 'study') {
      setFeedback({
        tone: 'good',
        label: '命中谱招',
        title: `${toChineseNotation(before, move)}，与原谱一致`,
        summary: expectedIndex + 1 >= studyLine.moves.length ? '本段棋谱已经完成。' : '谱线继续，轮到另一方行棋。',
        detail: '正在用皮卡鱼核对这步的局面价值。',
        bestMove: expectedMove,
        bestNotation: expectedLabel,
        loss: 0,
        variation: '',
      });
    }

    setBusy('正在复盘这步棋');
    try {
      const beforeResult = await analyzePosition(beforeFen, { movetime: 560, multiPV: 3 });
      const afterResult = await analyzePosition(currentGame.fen, { movetime: 520, multiPV: 3 });
      if (gameRef.current !== currentGame) return;
      const coached = buildCoachFeedback(before, move, beforeResult, afterResult);
      setAnalysis(beforeResult);
      setAnalysisPosition(before);

      if (mode === 'study' && !followedLine && expectedMove) {
        const engineChoice = coached.bestNotation;
        const bookNotation = toChineseNotation(before, expectedMove);
        coached.label = '偏离棋谱';
        coached.title = `${toChineseNotation(before, move)} 偏离原谱`;
        coached.summary = `原谱招是 ${bookNotation}。${coached.summary}`;
        coached.detail = engineChoice === bookNotation
          ? `谱招 ${bookNotation} 也是皮卡鱼首选，能保持原定布局次序并争取主动。`
          : `谱招 ${bookNotation} 保持了这条变化的布局次序；皮卡鱼当前另一个可行选择是 ${engineChoice ?? '调整子力'}。`;
        coached.bestMove = expectedMove;
        coached.bestNotation = bookNotation;
        coached.variation = `原谱：${studyLine.labels.slice(moveIndex, moveIndex + 6).join('，')}`;
      }
      setFeedback(coached);

      if (mode === 'play' && !currentGame.status().over) {
        await makeEngineMove(currentGame, afterResult);
      }
    } catch {
      if (mode === 'play' && !currentGame.status().over) await makeEngineMove(currentGame, null);
    } finally {
      if (gameRef.current === currentGame) setBusy('');
    }
  }

  async function makeEngineMove(currentGame: Game, prepared: AnalysisSnapshot | null): Promise<void> {
    setBusy('对手正在思考');
    let move: Move | null = prepared?.bestmove ? parseUcci(prepared.bestmove) : null;
    try {
      if (!move || !currentGame.isLegal(move)) {
        const result = await analyzePosition(currentGame.fen, { movetime: DIFFICULTY[difficulty], multiPV: 1 });
        move = result.bestmove ? parseUcci(result.bestmove) : null;
      }
    } catch {
      move = fallbackMove(currentGame);
    }
    if (gameRef.current !== currentGame || !move || !currentGame.isLegal(move)) return;
    currentGame.move(move);
    refresh();
  }

  async function requestHint(): Promise<void> {
    if (busy || status.over) return;
    setBusy('正在寻找好棋');
    try {
      const result = await analyzePosition(game.fen, { movetime: 850, multiPV: 3 });
      setAnalysis(result);
      setAnalysisPosition(game.position);
      const best = result.bestmove ? parseUcci(result.bestmove) : null;
      if (best) {
        setSelected(best.from);
        setTargets([best]);
      }
    } finally {
      setBusy('');
    }
  }

  function undo(): void {
    if (busy || !game.history.length) return;
    game.undo();
    if (mode === 'play' && game.history.length && game.turn !== playerColor) game.undo();
    setFeedback(null);
    setAnalysis(null);
    clearSelection();
    refresh();
  }

  function followBookMove(): void {
    const expected = feedback?.bestMove;
    if (!expected || mode !== 'study') return;
    game.undo();
    if (game.isLegal(expected)) game.move(expected);
    setFeedback({
      ...feedback,
      tone: 'good',
      label: '已回到谱线',
      title: `${feedback.bestNotation ?? '谱招'}，继续打谱`,
      summary: '局面已按原谱修正。',
    });
    clearSelection();
    refresh();
  }

  function confirmImport(): void {
    const parsed = parseRecord(importText);
    if (!parsed.moves.length) {
      setImportError('没有识别到合法着法，请粘贴中文着法或 UCCI 坐标。');
      return;
    }
    setStudyLine({ name: '天天象棋导入棋谱', ...parsed });
    setImportOpen(false);
    setImportError('');
    reset('study');
  }

  function exportRecord(): void {
    const text = game.history
      .reduce<string[]>((rows, record, index) => {
        if (index % 2 === 0) rows.push(`${Math.floor(index / 2) + 1}. ${record.notation}`);
        else rows[rows.length - 1] += ` ${record.notation}`;
        return rows;
      }, [])
      .join('\n');
    const blob = new Blob([text || '尚未行棋'], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `弈鉴棋谱-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (mode !== 'play' || playerColor !== 'b' || gameRef.current.history.length || busy) return;
    void makeEngineMove(gameRef.current, null).finally(() => setBusy(''));
    // Only opening a new black-side game should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, playerColor, revision]);

  return (
    <div className="app-shell" data-revision={revision}>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">弈</div>
          <div>
            <h1>弈鉴</h1>
            <p>象棋训练室</p>
          </div>
        </div>
        <nav className="mode-tabs" aria-label="训练模式">
          <button className={mode === 'study' ? 'active' : ''} onClick={() => reset('study')}>
            <BookOpen size={17} />打谱复盘
          </button>
          <button className={mode === 'play' ? 'active' : ''} onClick={() => reset('play')}>
            <Bot size={18} />人机对弈
          </button>
        </nav>
        <EnginePill state={engineState} onRetry={() => void initializeEngine().catch(() => undefined)} />
      </header>

      <main className="workspace">
        <aside className="left-rail">
          {mode === 'study' ? (
            <section className="rail-section">
              <div className="section-kicker">当前棋谱</div>
              <h2>{studyLine.name}</h2>
              <div className="record-progress">
                <span style={{ width: `${Math.min(100, (game.history.length / Math.max(1, studyLine.moves.length)) * 100)}%` }} />
              </div>
              <div className="record-meta"><span>{game.history.length} / {studyLine.moves.length} 步</span><span>{expectedLabel ? `下一步 ${expectedLabel}` : '已完成'}</span></div>
              <button className="secondary wide" onClick={() => setImportOpen(true)}><Upload size={16} />导入天天象棋棋谱</button>
            </section>
          ) : (
            <section className="rail-section">
              <div className="section-kicker">对局设置</div>
              <h2>皮卡鱼陪练</h2>
              <label className="control-label">我的执子</label>
              <div className="segmented">
                <button className={playerColor === 'w' ? 'active' : ''} onClick={() => { setPlayerColor('w'); reset('play'); }}>红方</button>
                <button className={playerColor === 'b' ? 'active' : ''} onClick={() => { setPlayerColor('b'); reset('play'); }}>黑方</button>
              </div>
              <label className="control-label">引擎强度</label>
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
                <option>入门</option><option>进阶</option><option>高手</option>
              </select>
              <button className="secondary wide" onClick={() => reset('play')}><Plus size={16} />新开一局</button>
            </section>
          )}

          <section className="rail-section move-section">
            <div className="section-header"><h3>着法记录</h3><button className="icon-button" title="导出棋谱" onClick={exportRecord}><Download size={16} /></button></div>
            <MoveList game={game} current={game.history.length} />
          </section>
        </aside>

        <section className="board-stage">
          <div className="player-row top-player">
            <Player color={flipped ? 'w' : 'b'} active={game.turn === (flipped ? 'w' : 'b')} ai={mode === 'play' && playerColor === (flipped ? 'b' : 'w')} />
            <span className="turn-chip">{status.over ? resultText(status.result) : `${game.turn === 'w' ? '红方' : '黑方'}行棋`}</span>
          </div>
          <XiangqiBoard
            position={game.position}
            selected={selected}
            targets={targets}
            lastMove={game.lastMove?.move ?? null}
            flipped={flipped}
            disabled={!canUserMove}
            onSquare={onSquare}
          />
          <div className="player-row bottom-player">
            <Player color={flipped ? 'b' : 'w'} active={game.turn === (flipped ? 'b' : 'w')} ai={mode === 'play' && playerColor === (flipped ? 'w' : 'b')} />
            <div className="board-actions">
              <button className="icon-button" title="悔棋" onClick={undo} disabled={!game.history.length || Boolean(busy)}><RotateCcw size={18} /></button>
              <button className="icon-button" title="翻转棋盘" onClick={() => setFlipped((value) => !value)}><FlipVertical2 size={18} /></button>
              <button className="hint-button" onClick={() => void requestHint()} disabled={Boolean(busy) || status.over}><Lightbulb size={17} />提示</button>
            </div>
          </div>
          {busy && <div className="thinking-line"><LoaderCircle size={15} className="spin" />{busy}</div>}
        </section>

        <aside className="analysis-rail">
          <section className="coach-panel">
            <div className="panel-title"><div><span className="eyebrow"><BrainCircuit size={14} />教练讲解</span><h2>{feedback?.title ?? '等待你的下一步'}</h2></div>{feedback && <span className={`grade ${feedback.tone}`}>{feedback.label}</span>}</div>
            {feedback ? (
              <>
                <p className="coach-summary">{feedback.summary}</p>
                <div className={`insight ${feedback.tone}`}><Sparkles size={17} /><p>{feedback.detail}</p></div>
                {feedback.variation && <div className="variation"><span>推荐变化</span><strong>{feedback.variation}</strong></div>}
                {mode === 'study' && feedback.label === '偏离棋谱' && feedback.bestMove && (
                  <button className="primary wide" onClick={followBookMove}><Play size={16} />回到谱招 {feedback.bestNotation}</button>
                )}
              </>
            ) : (
              <div className="empty-coach"><CircleHelp size={24} /><p>{mode === 'study' ? `本回合谱招：${expectedLabel ?? '棋谱已完成'}` : '明显失误出现时，讲解会在这里展开。'}</p></div>
            )}
          </section>

          <section className="lines-panel">
            <div className="section-header"><div><span className="eyebrow">皮卡鱼分析</span><h3>候选着法</h3></div><Settings2 size={17} /></div>
            <AnalysisLines analysis={analysis} position={analysisPosition ?? game.position} />
          </section>
          <footer className="source-links">
            <a href="https://github.com/official-pikafish/Pikafish" target="_blank" rel="noreferrer">Pikafish</a>
            <span>·</span>
            <a href="https://github.com/Maicarons/pikafish-js" target="_blank" rel="noreferrer">WebAssembly 源码</a>
            <span>· AGPL-3.0</span>
          </footer>
        </aside>
      </main>

      {importOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setImportOpen(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <div className="dialog-head"><div><span className="eyebrow">棋谱导入</span><h2 id="import-title">天天象棋棋谱</h2></div><button className="icon-button" title="关闭" onClick={() => setImportOpen(false)}><X size={18} /></button></div>
            <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={9} spellCheck={false} />
            {importError && <p className="form-error">{importError}</p>}
            <div className="dialog-actions"><button className="secondary" onClick={() => setImportText(SAMPLE_RECORD)}>载入示例</button><button className="primary" onClick={confirmImport}><Upload size={16} />开始打谱</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function EnginePill({ state, onRetry }: { state: EngineState; onRetry: () => void }) {
  return (
    <button className={`engine-pill ${state.phase}`} onClick={state.phase === 'error' ? onRetry : undefined} title={state.message}>
      {state.phase === 'loading' ? <LoaderCircle size={15} className="spin" /> : <span className="status-dot" />}
      <span>{state.phase === 'ready' ? '皮卡鱼在线' : state.phase === 'error' ? '分析离线' : '引擎加载中'}</span>
      {state.phase === 'loading' && <i style={{ width: `${state.progress * 100}%` }} />}
    </button>
  );
}

function Player({ color, active, ai }: { color: Color; active: boolean; ai: boolean }) {
  return <div className={`player ${active ? 'active' : ''}`}><span className={`avatar ${color}`}>{color === 'w' ? '帅' : '将'}</span><div><strong>{ai ? '皮卡鱼' : color === 'w' ? '红方' : '黑方'}</strong><small>{active ? '正在行棋' : ai ? '本地 AI' : '训练方'}</small></div></div>;
}

function resultText(result: 'red' | 'black' | 'draw' | null): string {
  if (result === 'red') return '红方胜';
  if (result === 'black') return '黑方胜';
  return '和棋';
}

function MoveList({ game, current }: { game: Game; current: number }) {
  if (!game.history.length) return <div className="empty-list">尚未行棋</div>;
  const rows = [];
  for (let index = 0; index < game.history.length; index += 2) {
    rows.push(
      <div className="move-row" key={index}>
        <span>{index / 2 + 1}.</span>
        <button className={current === index + 1 ? 'current' : ''}>{game.history[index]?.notation}</button>
        <button className={current === index + 2 ? 'current' : ''}>{game.history[index + 1]?.notation ?? ''}</button>
      </div>,
    );
  }
  return <div className="move-list">{rows}</div>;
}

function AnalysisLines({ analysis, position }: { analysis: AnalysisSnapshot | null; position: Position }) {
  if (!analysis?.lines.length) return <div className="empty-lines"><span>01</span><p>完成一步棋后显示引擎主变</p></div>;
  return <div className="analysis-lines">{analysis.lines.slice(0, 3).map((info, index) => (
    <div className="analysis-line" key={index}><span className="line-rank">{String(index + 1).padStart(2, '0')}</span><div><strong>{pvToChinese(position, info.pv)}</strong><small>深度 {info.depth ?? '--'} · {info.nps ? `${Math.round(info.nps / 1000)}k n/s` : '本地计算'}</small></div><b>{scoreLabel(info)}</b></div>
  ))}</div>;
}

function XiangqiBoard({ position, selected, targets, lastMove, flipped, disabled, onSquare }: {
  position: Position; selected: Square | null; targets: Move[]; lastMove: Move | null; flipped: boolean; disabled: boolean; onSquare: (square: Square) => void;
}) {
  const pieces = useMemo(() => {
    const list: Array<{ square: Square; color: Color; type: keyof typeof PIECE_NAMES }> = [];
    for (let rank = 0; rank < 10; rank++) for (let file = 0; file < 9; file++) {
      const piece = position.board[rank]?.[file];
      if (piece) list.push({ square: { file, rank }, color: piece.color, type: piece.type });
    }
    return list;
  }, [position]);

  function point(square: Square): { left: string; top: string } {
    const file = flipped ? 8 - square.file : square.file;
    const rankFromTop = flipped ? square.rank : 9 - square.rank;
    return { left: `${file * 12.5}%`, top: `${rankFromTop * (100 / 9)}%` };
  }

  const targetMap = new Map(targets.map((move) => [`${move.to.file}-${move.to.rank}`, move]));
  return (
    <div className={`xiangqi-frame ${disabled ? 'disabled' : ''}`}>
      <div className="board-surface">
        <div className="board-grid" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => <i className="horizontal" style={{ top: `${index * (100 / 9)}%` }} key={`h${index}`} />)}
          {Array.from({ length: 9 }, (_, index) => <i className={`vertical v${index}`} style={{ left: `${index * 12.5}%` }} key={`v${index}`} />)}
          <span className="river"><b>楚 河</b><b>漢 界</b></span>
          <i className="palace p1" /><i className="palace p2" /><i className="palace p3" /><i className="palace p4" />
        </div>
        {Array.from({ length: 90 }, (_, index) => {
          const square = { file: index % 9, rank: Math.floor(index / 9) };
          const target = targetMap.get(`${square.file}-${square.rank}`);
          const isLast = lastMove && (sameSquare(lastMove.from, square) || sameSquare(lastMove.to, square));
          return <button key={index} className={`square-hit ${target ? 'target' : ''} ${isLast ? 'last' : ''}`} style={point(square)} onClick={() => onSquare(square)} aria-label={`${String.fromCharCode(97 + square.file)}${square.rank}`}><span /></button>;
        })}
        {pieces.map(({ square, color, type }) => (
          <button key={`${square.file}-${square.rank}`} className={`piece ${color === 'w' ? 'red' : 'black'} ${selected && sameSquare(selected, square) ? 'selected' : ''}`} style={point(square)} onClick={() => onSquare(square)} disabled={disabled} aria-label={`${color === 'w' ? '红' : '黑'}${PIECE_NAMES[type][color === 'w' ? 'red' : 'black']}`}>
            <span>{PIECE_NAMES[type][color === 'w' ? 'red' : 'black']}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default App;
