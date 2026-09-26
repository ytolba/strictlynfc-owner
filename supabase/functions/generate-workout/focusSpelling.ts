// Shared by the planner function and the app: fixes misspelled training words ("glutse", "hamstirngs")
// so the member sees "Did you mean …" in the app and the server plans for the intended muscles.
// Plain TypeScript only, so Deno and Metro can both import it.

const VOCABULARY = [
  'chest', 'pecs', 'pectorals', 'back', 'lats', 'traps', 'rhomboids', 'shoulders', 'shoulder', 'delts', 'deltoids',
  'legs', 'quads', 'quadriceps', 'hamstrings', 'hamstring', 'glutes', 'glute', 'calves', 'calf',
  'arms', 'biceps', 'bicep', 'triceps', 'tricep', 'forearms', 'core', 'abs', 'abdominals', 'obliques',
  'full', 'body', 'upper', 'lower', 'push', 'pull', 'legs', 'workout', 'strength', 'focus', 'only', 'with', 'and', 'plus', 'day'
];
// Real words that are close to vocabulary words but must be left alone ("booty" is not a typo for "body").
const LEAVE_ALONE = ['booty', 'butt', 'hips', 'bench', 'press', 'squat', 'squats', 'heavy', 'light', 'easy', 'hard', 'quick', 'machine', 'machines', 'cardio', 'stretch', 'today', 'lift', 'lifts', 'posture', 'leg', 'arm', 'hip', 'lat', 'pec', 'the', 'for', 'set', 'sets', 'reps', 'mid', 'low', 'big', 'long', 'short'];
const KNOWN = new Set([...VOCABULARY, ...LEAVE_ALONE]);

export type FocusCorrection = { from: string; to: string };

// Optimal string alignment distance: insertions, deletions, substitutions and swapped neighbours each cost 1.
function distance(a: string, b: string) {
  const rows = a.length + 1, cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i]!, above = d[i - 1]!;
      let best = Math.min(above[j]! + 1, row[j - 1]! + 1, above[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, d[i - 2]![j - 2]! + 1);
      row[j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

function closest(word: string) {
  // Short words need an exact-ish match; longer words tolerate two slips. Three-letter words must also
  // keep their first letter ("bak" → back), which keeps unrelated short words from being rewritten.
  const allowed = word.length <= 5 ? 1 : 2;
  let best: string | null = null, bestDistance = allowed + 1;
  for (const candidate of VOCABULARY) {
    if (Math.abs(candidate.length - word.length) > allowed) continue;
    if (word.length === 3 && candidate[0] !== word[0]) continue;
    const value = distance(word, candidate);
    if (value < bestDistance) { best = candidate; bestDistance = value; }
  }
  return best;
}

// asking: true is for the app's "Did you mean" hint, which should only appear for a word that isn't understood.
// A word that is the start of a known word ("glut", "hamst") is still being typed, so it is left alone.
export function correctFocus(input: string, { asking = false } = {}): { text: string; corrections: FocusCorrection[] } {
  const corrections: FocusCorrection[] = [];
  const text = input.replace(/[A-Za-z]+/g, (word) => {
    const lower = word.toLowerCase();
    if (lower.length < 3 || KNOWN.has(lower)) return word;
    if (asking && [...KNOWN].some((known) => known.startsWith(lower))) return word;
    const match = closest(lower);
    if (!match || match === lower) return word;
    corrections.push({ from: word, to: match });
    return match;
  });
  return { text, corrections };
}
