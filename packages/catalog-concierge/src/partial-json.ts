/**
 * Reading an answer out of JSON that has not finished arriving.
 *
 * When the model streams, its reply reaches us as fragments of the `respond`
 * call's arguments: `{"answer":"The Atl`, then `as suits begin`, and so on.
 * Waiting for valid JSON means waiting for the whole turn, which is the thing
 * streaming exists to avoid — so the string is read as far as it goes, and
 * not one character further.
 *
 * Deliberately not a JSON parser. It finds one string value and stops.
 */

/** The key and the opening quote of its value: `"answer": "` in any spacing. */
const ANSWER_OPENS = /"answer"\s*:\s*"/;

/** The value of `"answer"` so far, or "" if it has not started arriving. */
export function partialAnswer(argumentsSoFar: string): string {
  const opens = ANSWER_OPENS.exec(argumentsSoFar);
  return opens ? readString(argumentsSoFar, opens.index + opens[0].length) : "";
}

/** The JSON string starting at `from`, up to its end or the end of what we have. */
function readString(raw: string, from: number): string {
  let out = "";

  for (let i = from; i < raw.length; i++) {
    const char = raw[i]!;
    if (char === '"') return out; // closed: the whole value
    if (char !== "\\") {
      out += char;
      continue;
    }

    const escape = raw[i + 1];
    // A backslash at the very end is half an escape sequence: stop rather than
    // guess, and the next fragment will bring the rest.
    if (escape === undefined) return out;
    i += 1;

    if (escape === "u") {
      const hex = raw.slice(i + 1, i + 5);
      if (hex.length < 4) return out; // the code point is still arriving
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
      continue;
    }

    out += UNESCAPED[escape] ?? escape;
  }

  return out;
}

const UNESCAPED: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
