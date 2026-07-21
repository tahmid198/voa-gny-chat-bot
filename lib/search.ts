import type { Chunk, DocumentIndex } from "./store";

export interface SearchHit {
  chunk: Chunk;
  score: number;
  snippet: string;
}

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","can","did","do","does","for",
  "from","had","has","have","how","i","if","in","is","it","its","me","my","of",
  "on","or","our","so","than","that","the","their","them","then","there","these",
  "they","this","to","was","we","were","what","when","where","which","who","why",
  "will","with","you","your","about","please","tell","give",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Very light stemming so "policies" matches "policy", "reports" matches "report". */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("ses")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function terms(text: string): string[] {
  return tokenize(text).map(stem);
}

const K1 = 1.5;
const B = 0.75;

/** Pull the region of the chunk with the highest density of query terms. */
function makeSnippet(text: string, queryTerms: Set<string>, length = 240): string {
  const words = text.split(/\s+/);
  if (words.length <= 45) return text;

  const window = 40;
  let bestStart = 0;
  let bestScore = -1;

  for (let i = 0; i <= words.length - window; i += 5) {
    let score = 0;
    for (let j = i; j < i + window; j++) {
      const w = stem(words[j].toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (w && queryTerms.has(w)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  const snippet = words.slice(bestStart, bestStart + window).join(" ");
  const prefix = bestStart > 0 ? "… " : "";
  const suffix = bestStart + window < words.length ? " …" : "";
  return `${prefix}${snippet.slice(0, length)}${suffix}`;
}

/**
 * BM25 ranking over the chunk collection, with a bonus when the query matches
 * words in the file name (people often ask "what's in the safety handbook").
 */
export function search(index: DocumentIndex, query: string, limit: number): SearchHit[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0 || index.chunks.length === 0) return [];

  const uniqueTerms = [...new Set(queryTerms)];
  const querySet = new Set(uniqueTerms);

  // Term frequencies per chunk + document frequency per term.
  const tfPerChunk: Map<string, number>[] = [];
  const lengths: number[] = [];
  const df = new Map<string, number>();

  for (const chunk of index.chunks) {
    const tokens = terms(chunk.text);
    lengths.push(tokens.length || 1);

    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    tfPerChunk.push(tf);

    for (const term of uniqueTerms) {
      if (tf.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const N = index.chunks.length;
  const avgLen = lengths.reduce((a, b) => a + b, 0) / N;

  const hits: SearchHit[] = [];

  for (let i = 0; i < N; i++) {
    const chunk = index.chunks[i];
    const tf = tfPerChunk[i];
    const len = lengths[i];
    let score = 0;

    for (const term of uniqueTerms) {
      const f = tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / avgLen)));
    }

    if (score <= 0) continue;

    // Filename relevance bonus.
    const nameTerms = new Set(terms(chunk.file.replace(/[/\\._-]/g, " ")));
    const nameMatches = uniqueTerms.filter((t) => nameTerms.has(t)).length;
    if (nameMatches > 0) score *= 1 + 0.25 * nameMatches;

    hits.push({ chunk, score, snippet: makeSnippet(chunk.text, querySet) });
  }

  hits.sort((a, b) => b.score - a.score);

  // Cap how much any single file can dominate the context window.
  const perFile = new Map<string, number>();
  const diversified: SearchHit[] = [];
  const maxPerFile = Math.max(2, Math.ceil(limit / 2));

  for (const hit of hits) {
    const count = perFile.get(hit.chunk.file) ?? 0;
    if (count >= maxPerFile) continue;
    perFile.set(hit.chunk.file, count + 1);
    diversified.push(hit);
    if (diversified.length >= limit) break;
  }

  return diversified;
}
