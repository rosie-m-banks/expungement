/* gemini_classify.js
 * Ports legal_statutes/embeddings.py using the Gemini JS SDK.
 * Exposes window.geminiClassify = { classifyCount, classifyCounts }.
 *
 * Requires window.GEMINI_API_KEY (injected by the build via config.js).
 */
(function () {
  'use strict';

  const SDK_URL = 'https://esm.sh/@google/generative-ai';

  /* Cached SDK module, GenAI instance, and per-statute data */
  let _sdkModule = null;
  let _genAI = null;
  const _statuteCache = {};

  async function _ensureSDK() {
    if (_sdkModule) return;
    _sdkModule = await import(SDK_URL);
    const apiKey = sessionStorage.getItem('gemini_api_key') || '';
    _genAI = new _sdkModule.GoogleGenerativeAI(apiKey);
  }

  /* ---- Statute data loading ---- */

  async function _loadStatuteData(name) {
    if (_statuteCache[name]) return _statuteCache[name];
    const base = 'legal_statutes/';
    const [textResp, embedResp] = await Promise.all([
      fetch(base + name + '.txt'),
      fetch(base + name + '_embed.txt'),
    ]);
    const textContent = await textResp.text();
    const embedContent = await embedResp.text();

    const crimes = textContent.split('\n').map(l => l.trim()).filter(Boolean);
    const embeddings = embedContent.trim().split('\n')
      .filter(Boolean)
      .map(line => line.trim().split(/\s+/).map(Number));

    _statuteCache[name] = { crimes, embeddings };
    return _statuteCache[name];
  }

  /* ---- Math helpers ---- */

  function _dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /* ---- Embedding query ---- */

  async function _embedQuery(text) {
    await _ensureSDK();
    const model = _genAI.getGenerativeModel({ model: 'models/gemini-embedding-001' });
    const result = await model.embedContent(text);
    const vec = result.embedding.values;
    const norm = Math.sqrt(_dot(vec, vec));
    return norm > 0 ? vec.map(v => v / norm) : vec;
  }

  /* ---- Top-k cosine similarity ---- */

  function _topK(queryVec, embeddings, k) {
    const scored = embeddings.map((emb, i) => ({ i, score: _dot(emb, queryVec) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /* ---- LLM match  (mirrors embeddings.py get_best_from_top_k) ---- */

  async function _llmMatch(topKResults, crimes, query) {
    await _ensureSDK();
    const { HarmCategory, HarmBlockThreshold } = _sdkModule;
    const model = _genAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });
    const crimeString = topKResults.map(({ i }) => crimes[i]).join('\n ');
    const prompt =
      `I have a list of newline separated legal statute descriptions ${crimeString}.` +
      `        I have a legal statute description ${query}. Of the counts provided, does this statute match any of them? ` +
      `        The language may be different, but if the meaning is the same, please return that count. Otherwise, return 0. Do not return anything else.`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    return text === '0' ? null : text;
  }

  /* ---- Single-statute check ---- */

  async function _checkStatute(name, query) {
    try {
      const { crimes, embeddings } = await _loadStatuteData(name);
      const queryVec = await _embedQuery(query);
      const top = _topK(queryVec, embeddings, 5);
      const match = await _llmMatch(top, crimes, query);
      return match !== null;
    } catch (err) {
      console.warn(`gemini_classify: error checking statute ${name}:`, err);
      return false;
    }
  }

  /* ---- Public: classify a single count ---- */
  /*  Mirrors web_server.py classify_count precedence:                   */
  /*    reclassified → none (not in 571) → 13-sora → 571               */

  async function classifyCount(count) {
    try {
      if (await _checkStatute('reclassified', count)) return 'reclassified';
      if (!(await _checkStatute('section571', count))) return 'none';
      if (await _checkStatute('section13', count))     return '13-sora';
      if (await _checkStatute('SORA', count))          return '13-sora';
      return '571';
    } catch (err) {
      console.error('gemini_classify: classifyCount failed:', err);
      return 'none';
    }
  }

  /* ---- Public: classify many counts ---- */

  async function classifyCounts(counts) {
    const classifications = [];
    for (const count of counts) {
      const cls = await classifyCount(count);
      classifications.push({ count, class: cls });
    }
    return { classifications };
  }

  window.geminiClassify = { classifyCount, classifyCounts };
})();
