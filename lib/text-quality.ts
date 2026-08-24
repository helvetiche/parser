export function textQualityScore(text: string): number {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 40) return 0;

  const words = trimmed.split(" ").filter(Boolean);
  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const letterRatio = letters / trimmed.length;
  const avgWordLen = letters / Math.max(words.length, 1);
  const realWords = (trimmed.match(/\b[A-Za-z]{3,}\b/g) ?? []).length;

  let score = letterRatio * 100 + Math.min(realWords, 60);
  if (avgWordLen < 1.5 || avgWordLen > 14) score /= 3;
  if (letterRatio < 0.35) score /= 3;
  return score;
}

/**
 * Heuristic check that extracted text actually looks like human language.
 * Catches CID-font garbage, mojibake and binary dumps before they reach
 * the model.
 */
export function isReadableText(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < 80) return false;

  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  const letterRatio = letters / trimmed.length;
  if (letterRatio < 0.45) return false;

  const words = trimmed.split(" ").filter(Boolean);
  const avgWordLen = letters / Math.max(words.length, 1);
  if (avgWordLen < 1.5 || avgWordLen > 14) return false;

  const realWords = (trimmed.match(/\b[A-Za-z]{3,}\b/g) ?? []).length;
  return realWords >= 10;
}
