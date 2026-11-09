import {
  Game,
  generateLegalMoves,
  moveToUcci,
  toChineseNotation,
  type Move,
  type Position,
} from '@pikafish-js/rules';

const DIGITS: Record<string, string> = {
  '1': '一', '2': '二', '3': '三', '4': '四', '5': '五',
  '6': '六', '7': '七', '8': '八', '9': '九',
  '１': '一', '２': '二', '３': '三', '４': '四', '５': '五',
  '６': '六', '７': '七', '８': '八', '９': '九',
};

export function normalizeNotation(value: string): string {
  return value
    .trim()
    .replace(/[1-9１-９]/g, (digit) => DIGITS[digit] ?? digit)
    .replace(/[車俥]/g, '车')
    .replace(/[馬傌]/g, '马')
    .replace(/[砲包]/g, '炮')
    .replace(/[帥]/g, '帅')
    .replace(/[將]/g, '将')
    .replace(/進/g, '进')
    .replace(/将军$/, '')
    .replace(/[+#]+$/, '');
}

export function findMoveByNotation(position: Position, token: string): Move | null {
  const normalized = normalizeNotation(token);
  const ucci = token.trim().toLowerCase();
  const direct = generateLegalMoves(position).find((move) => moveToUcci(move) === ucci);
  if (direct) return direct;
  return (
    generateLegalMoves(position).find(
      (move) => normalizeNotation(toChineseNotation(position, move)) === normalized,
    ) ?? null
  );
}

export interface ParsedRecord {
  moves: string[];
  labels: string[];
  rejected: string[];
}

export function parseRecord(source: string): ParsedRecord {
  const tokens = source
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\d+[\.、]/g, ' ')
    .replace(/(1-0|0-1|1\/2-1\/2|红胜|黑胜|和棋)/g, ' ')
    .split(/[\s,，;；|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const game = new Game();
  const moves: string[] = [];
  const labels: string[] = [];
  const rejected: string[] = [];

  for (const token of tokens) {
    const move = findMoveByNotation(game.position, token);
    if (!move) {
      rejected.push(token);
      continue;
    }
    const record = game.move(move);
    moves.push(record.ucci);
    labels.push(record.notation.replace(/[+#]$/, ''));
  }
  return { moves, labels, rejected };
}

export const SAMPLE_RECORD = '炮二平五 马八进七 马二进三 车九平八 车一进一 炮八平九 车一平四 车八进六 车四进七 马二进三 车八平七 马三退五';
