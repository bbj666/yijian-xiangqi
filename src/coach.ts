import {
  applyMove,
  generateLegalMoves,
  moveToUcci,
  parseUcci,
  pieceAt,
  toChineseNotation,
  type Move,
  type Position,
} from '@pikafish-js/rules';
import type { AnalysisInfo } from 'pikafish-js';
import type { AnalysisSnapshot } from './engine';

export interface CoachFeedback {
  tone: 'good' | 'notice' | 'mistake' | 'blunder';
  label: string;
  title: string;
  summary: string;
  detail: string;
  bestMove: Move | null;
  bestNotation: string | null;
  loss: number;
  variation: string;
}

function score(info: AnalysisInfo | undefined): number {
  if (!info?.score) return 0;
  if (info.score.type === 'mate') return Math.sign(info.score.value || 1) * 100000;
  return info.score.value;
}

function pvText(position: Position, pv: string[] | undefined): string {
  if (!pv?.length) return '';
  const parts: string[] = [];
  let current = position;
  for (const text of pv.slice(0, 6)) {
    const move = parseUcci(text);
    if (!move) break;
    const legal = generateLegalMoves(current).some((candidate) => moveToUcci(candidate) === text);
    if (!legal) break;
    parts.push(toChineseNotation(current, move));
    current = applyMove(current, move);
  }
  return parts.join('，');
}

function tacticalDetail(before: Position, played: Move, bestMove: Move | null): string {
  const next = applyMove(before, played);
  const movedPiece = pieceAt(next.board, played.to);
  const canBeCaptured = generateLegalMoves(next).some(
    (reply) => reply.to.file === played.to.file && reply.to.rank === played.to.rank,
  );
  const bestPiece = bestMove ? pieceAt(before.board, bestMove.from) : null;

  if (canBeCaptured && movedPiece) {
    return '这步把刚移动的棋子放进了对方的直接攻击范围，后续容易被迫补救，主动权会交给对手。';
  }
  if (bestMove && bestPiece?.type === 'n') {
    return '推荐招优先改善马的活动范围，能减少蹩马腿，并为后续抢占中路保留更多选择。';
  }
  if (bestMove && bestPiece?.type === 'r') {
    return '推荐招让车更快进入开放线路，既能施压，也能减少其他子力被牵制的风险。';
  }
  if (bestMove && bestPiece?.type === 'c') {
    return '推荐招保留炮架并调整攻击角度，能让中路牵制持续得更久。';
  }
  return '这步让局面的协调性下降：对手更容易取得先手，而你需要额外一步才能重新组织子力。';
}

export function buildCoachFeedback(
  before: Position,
  played: Move,
  beforeAnalysis: AnalysisSnapshot,
  afterAnalysis: AnalysisSnapshot,
): CoachFeedback {
  const playedNotation = toChineseNotation(before, played);
  const bestMove = beforeAnalysis.bestmove ? parseUcci(beforeAnalysis.bestmove) : null;
  const bestNotation = bestMove ? toChineseNotation(before, bestMove) : null;
  const bestScore = score(beforeAnalysis.lines[0]);
  const afterScoreFromMover = -score(afterAnalysis.lines[0]);
  const rawLoss = Math.max(0, bestScore - afterScoreFromMover);
  const loss = Math.min(9999, Math.round(rawLoss));
  const isBest = beforeAnalysis.bestmove === moveToUcci(played);

  let tone: CoachFeedback['tone'] = 'good';
  let label = '稳健';
  if (!isBest && loss >= 240) {
    tone = 'blunder';
    label = '严重失误';
  } else if (!isBest && loss >= 110) {
    tone = 'mistake';
    label = '错误';
  } else if (!isBest && loss >= 45) {
    tone = 'notice';
    label = '可疑';
  }

  const variation = pvText(before, beforeAnalysis.lines[0]?.pv);
  if (tone === 'good') {
    return {
      tone,
      label: isBest ? '最佳' : label,
      title: `${playedNotation}，思路正确`,
      summary: isBest
        ? '这就是皮卡鱼当前首选，兼顾了效率与局面安全。'
        : `与首选招差距约 ${(loss / 100).toFixed(2)}，仍在可接受范围内。`,
      detail: bestNotation && !isBest ? `更积极的选择是 ${bestNotation}，它能更快争取主动。` : '继续保持子力协调，不必急于交换。',
      bestMove,
      bestNotation,
      loss,
      variation,
    };
  }

  return {
    tone,
    label,
    title: `${playedNotation}：${label}`,
    summary: `相较 ${bestNotation ?? '引擎首选'}，局面评价下降约 ${(loss / 100).toFixed(2)}。`,
    detail: tacticalDetail(before, played, bestMove),
    bestMove,
    bestNotation,
    loss,
    variation,
  };
}
