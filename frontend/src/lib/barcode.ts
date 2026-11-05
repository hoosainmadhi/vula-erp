/**
 * Minimal Code 39 encoder. Code 39 is a self-checking, variable-length symbology
 * that only needs a narrow/wide element table, so we can render scannable labels
 * without pulling in a barcode dependency.
 *
 * Each character is nine elements (five bars, four spaces) starting with a bar.
 * Three of the nine elements are wide; the rest are narrow.
 */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

export interface BarcodeBar {
  x: number;
  width: number;
}

export interface BarcodePattern {
  width: number;
  bars: BarcodeBar[];
  value: string;
}

const NARROW = 1;
const WIDE = 3;
const GAP = 1;

export function code39(raw: string): BarcodePattern {
  const cleaned = raw
    .toUpperCase()
    .split('')
    .filter((character) => character in PATTERNS && character !== '*')
    .join('')
    .slice(0, 40);
  const value = `*${cleaned}*`;

  const bars: BarcodeBar[] = [];
  let x = 0;
  for (const character of value) {
    const pattern = PATTERNS[character];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = pattern[index] === 'w' ? WIDE : NARROW;
      if (index % 2 === 0) bars.push({ x, width });
      x += width;
    }
    x += GAP;
  }

  return { width: Math.max(x - GAP, 1), bars, value: cleaned };
}
