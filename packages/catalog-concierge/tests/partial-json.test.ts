/**
 * Reading a reply out of JSON that is still arriving. Every case here is a
 * fragment boundary the model can actually land on mid-escape, mid-code
 * point, or mid-key.
 */
import { describe, expect, it } from "vitest";
import { partialAnswer } from "../src/partial-json";

describe("partialAnswer", () => {
  it("reads a string that has not been closed yet", () => {
    expect(partialAnswer('{"answer":"The Atl')).toBe("The Atl");
    expect(partialAnswer('{"answer":"The Atlas suits beginners."')).toBe("The Atlas suits beginners.");
  });

  it("reads a closed string and stops at its end", () => {
    expect(partialAnswer('{"answer":"The Atlas.","suggestions":["Compare them"]}')).toBe("The Atlas.");
  });

  it("says nothing until the value starts", () => {
    for (const fragment of ["", "{", '{"sugg', '{"answer"', '{"answer":', '{"answer": ']) {
      expect(partialAnswer(fragment), JSON.stringify(fragment)).toBe("");
    }
  });

  it("unescapes what JSON escapes", () => {
    expect(partialAnswer('{"answer":"line one\\nline two"}')).toBe("line one\nline two");
    expect(partialAnswer('{"answer":"a \\"quote\\" and a back\\\\slash"}')).toBe('a "quote" and a back\\slash');
    expect(partialAnswer('{"answer":"tab\\there"}')).toBe("tab\there");
    expect(partialAnswer('{"answer":"a slash \\/ here"}')).toBe("a slash / here");
  });

  it("waits rather than guessing when an escape is cut in half", () => {
    // The fragment ends on the backslash itself.
    expect(partialAnswer('{"answer":"line one\\')).toBe("line one");
    // …and on an incomplete code point.
    expect(partialAnswer('{"answer":"price \\u20')).toBe("price ");
    expect(partialAnswer('{"answer":"price \\u20ac"}')).toBe("price €");
  });

  it("grows one character at a time without ever going backwards", () => {
    const whole = '{"answer":"Both are 16mm \\"control\\" paddles.\\nThe Atlas is lighter.","suggestions":[]}';
    let previous = "";
    for (let i = 0; i <= whole.length; i++) {
      const soFar = partialAnswer(whole.slice(0, i));
      expect(soFar.startsWith(previous) || previous.startsWith(soFar), `at ${i}: ${JSON.stringify(soFar)}`).toBe(true);
      if (soFar.length >= previous.length) previous = soFar;
    }
    expect(previous).toBe('Both are 16mm "control" paddles.\nThe Atlas is lighter.');
  });

  it("ignores a different key that happens to come first", () => {
    expect(partialAnswer('{"suggestions":["answer"],"answer":"The Atlas."}')).toBe("The Atlas.");
  });
});

describe("partialAnswer — text that looks like the key", () => {
  it("is not fooled by the word appearing inside another value", () => {
    expect(partialAnswer('{"note":"answer: \\"later\\"","answer":"The Atlas."}')).toBe("The Atlas.");
  });

  it("allows whatever spacing the model happens to emit", () => {
    expect(partialAnswer('{ "answer" : "The Atlas." }')).toBe("The Atlas.");
  });
});
