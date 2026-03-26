function tryParseJson(value) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false, value: undefined };
  }
}

function extractJsonFromPossiblyPollutedOutput(shellOutput) {
  const consoleOutput = shellOutput.trim();
  const directParse = tryParseJson(consoleOutput);

  if (directParse.ok) {
    return directParse.value;
  }

  for (let start = 0; start < consoleOutput.length; start += 1) {
    const startChar = consoleOutput[start];
    if (startChar !== "{" && startChar !== "[") {
      continue;
    }

    const stack = [startChar];
    let inString = false;
    let isEscaped = false;

    for (let index = start + 1; index < consoleOutput.length; index += 1) {
      const char = consoleOutput[index];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }

        if (char === "\\") {
          isEscaped = true;
          continue;
        }

        if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char);
        continue;
      }

      if (char === "}" || char === "]") {
        const expectedOpen = char === "}" ? "{" : "[";
        const open = stack[stack.length - 1];

        if (open !== expectedOpen) {
          break;
        }

        stack.pop();

        if (stack.length === 0) {
          const candidate = consoleOutput.slice(start, index + 1);
          const parsedCandidate = tryParseJson(candidate);

          if (parsedCandidate.ok) {
            return parsedCandidate.value;
          }

          break;
        }
      }
    }
  }

  throw new Error("No JSON content found in output");
}

module.exports = {
  extractJsonFromPossiblyPollutedOutput,
};
