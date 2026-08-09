/* gemini_classify.js
 * Ports legal_statutes/embeddings.py to the browser using the Gemini REST API.
 * Exposes window.geminiClassify = { classifyCount, classifyCounts }.
 *
 * The API key is entered by the user on the landing page and read from
 * sessionStorage. Nothing is bundled into the deployed files.
 *
 * The generative model is discovered at runtime via ListModels rather than
 * hardcoded, so Google deprecating a model ID cannot break this page.
 *
 * The EMBEDDING model is deliberately pinned: the checked-in *_embed.txt
 * vectors are 3072-dim gemini-embedding-001 outputs, and cosine similarity is
 * only meaningful against query vectors from that same model.
 */
(function () {
  'use strict';

  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const EMBED_MODEL = 'gemini-embedding-001';   // must match *_embed.txt (3072-dim)
  const EMBED_DIMS = 3072;

  /* Preferred generative models, best first. Filtered against ListModels, so
     unknown/retired entries are skipped rather than causing a 404. */
  const MODEL_PREFERENCE = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ];

  let _resolvedModel = null;
  const _statuteCache = {};

  function _apiKey() {
    const key = sessionStorage.getItem('gemini_api_key');
    if (!key) throw new Error('No Gemini API key set. Return to the start page and enter one.');
    return key;
  }

  /* ---- Model discovery ---------------------------------------------- */

  function _shortName(name) {
    return String(name || '').replace(/^models\//, '');
  }

  /* Rank an arbitrary model id so the fallback path still picks something
     sensible if none of MODEL_PREFERENCE are available. */
  function _scoreModel(id) {
    if (/embedding|tts|image|audio|live|vision/.test(id)) return -1;
    const ver = parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
    let score = ver * 10;
    if (id.includes('flash')) score += 3;
    if (id.includes('pro')) score += 2;
    if (id.includes('lite')) score -= 1;
    if (id.includes('preview')) score -= 0.5;
    return score;
  }

  async function _resolveModel() {
    if (_resolvedModel) return _resolvedModel;

    const resp = await fetch(`${API_BASE}/models?key=${encodeURIComponent(_apiKey())}&pageSize=200`);
    if (!resp.ok) {
      throw new Error(`Could not list Gemini models (HTTP ${resp.status}). Check that your API key is valid.`);
    }
    const data = await resp.json();

    const all = (data.models || []).map(m => ({
      id: _shortName(m.name),
      methods: m.supportedGenerationMethods || [],
    }));

    /* The embedding model cannot be substituted: the checked-in vectors are
       gemini-embedding-001 outputs. Fail with something actionable rather
       than a bare 404 from the embed call. */
    if (!all.some(m => m.id === EMBED_MODEL && m.methods.includes('embedContent'))) {
      throw new Error(
        `Your API key cannot access ${EMBED_MODEL}, which the precomputed statute ` +
        `vectors depend on. Regenerate legal_statutes/*_embed.txt with an available ` +
        `embedding model, or use a key that has access.`
      );
    }

    const usable = all.filter(m => m.methods.includes('generateContent')).map(m => m.id);
    if (!usable.length) throw new Error('Your API key has no models available for generateContent.');

    _resolvedModel =
      MODEL_PREFERENCE.find(p => usable.includes(p)) ||
      usable.filter(id => _scoreModel(id) > 0).sort((a, b) => _scoreModel(b) - _scoreModel(a))[0];

    if (!_resolvedModel) throw new Error('No suitable Gemini text model available for this API key.');
    console.info('gemini_classify: using model', _resolvedModel);
    return _resolvedModel;
  }

  /* ---- Statute data loading ------------------------------------------ */

  async function _loadStatuteData(name) {
    if (_statuteCache[name]) return _statuteCache[name];

    const [textResp, embedResp] = await Promise.all([
      fetch(`legal_statutes/${name}.txt`),
      fetch(`legal_statutes/${name}_embed.txt`),
    ]);
    if (!textResp.ok || !embedResp.ok) {
      throw new Error(`Could not load statute data for ${name}`);
    }
    const [textContent, embedContent] = await Promise.all([textResp.text(), embedResp.text()]);

    const crimes = textContent.split('\n').map(l => l.trim()).filter(Boolean);
    const embeddings = embedContent.split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(line => line.split(/\s+/).map(Number));

    /* crimes[i] must line up with embeddings[i]; a mismatch would silently
       return the wrong statute, so fail loudly instead. */
    if (crimes.length !== embeddings.length) {
      throw new Error(`Statute data for ${name} is misaligned: ${crimes.length} crimes vs ${embeddings.length} embeddings`);
    }

    _statuteCache[name] = { crimes, embeddings };
    return _statuteCache[name];
  }

  /* ---- Math ----------------------------------------------------------- */

  function _dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function _topK(queryVec, embeddings, k) {
    return embeddings
      .map((emb, i) => ({ i, score: _dot(emb, queryVec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /* ---- Gemini REST calls ---------------------------------------------- */

  async function _embedQuery(text) {
    const url = `${API_BASE}/models/${EMBED_MODEL}:embedContent?key=${encodeURIComponent(_apiKey())}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
      }),
    });
    if (!resp.ok) {
      throw new Error(`Embedding request failed (HTTP ${resp.status}): ${await resp.text()}`);
    }
    const data = await resp.json();
    const vec = data.embedding && data.embedding.values;
    if (!Array.isArray(vec)) throw new Error('Embedding response had no values');
    if (vec.length !== EMBED_DIMS) {
      throw new Error(`Embedding dimension ${vec.length} does not match precomputed ${EMBED_DIMS}`);
    }
    const norm = Math.sqrt(_dot(vec, vec));
    return norm > 0 ? vec.map(v => v / norm) : vec;
  }

  const SAFETY_SETTINGS = [
    'HARM_CATEGORY_DANGEROUS_CONTENT',
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  ].map(category => ({ category, threshold: 'BLOCK_NONE' }));

  /* Mirrors embeddings.py get_best_from_top_k */
  async function _llmMatch(topKResults, crimes, query) {
    const model = await _resolveModel();
    const crimeString = topKResults.map(({ i }) => crimes[i]).join('\n ');
    const prompt =
      `I have a list of newline separated legal statute descriptions ${crimeString}. ` +
      `I have a legal statute description ${query}. Of the counts provided, does this statute match any of them? ` +
      `The language may be different, but if the meaning is the same, please return that count. ` +
      `Otherwise, return 0. Do not return anything else.`;

    const url = `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(_apiKey())}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        safetySettings: SAFETY_SETTINGS,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Generation request failed (HTTP ${resp.status}): ${await resp.text()}`);
    }
    const data = await resp.json();

    /* Newer models can return internal "thought" parts; only real text counts. */
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
    const text = parts.filter(p => p && p.text && !p.thought).map(p => p.text).join('').trim();

    return (!text || text === '0') ? null : text;
  }

  /* ---- Statute check --------------------------------------------------- */

  async function _checkStatute(name, query) {
    const { crimes, embeddings } = await _loadStatuteData(name);
    const queryVec = await _embedQuery(query);
    const top = _topK(queryVec, embeddings, 5);
    return (await _llmMatch(top, crimes, query)) !== null;
  }

  /* ---- Public API ------------------------------------------------------ */

  /* Precedence mirrors web_server.py classify_count:
       reclassified → none (not in 571) → 13-sora → 571            */
  async function classifyCount(count) {
    if (await _checkStatute('reclassified', count)) return 'reclassified';
    if (!(await _checkStatute('section571', count))) return 'none';
    if (await _checkStatute('section13', count)) return '13-sora';
    if (await _checkStatute('SORA', count)) return '13-sora';
    return '571';
  }

  async function classifyCounts(counts) {
    const classifications = [];
    for (const count of counts) {
      classifications.push({ count, class: await classifyCount(count) });
    }
    return { classifications };
  }

  window.geminiClassify = { classifyCount, classifyCounts };

  /* Exposed for the node smoke test; harmless in the browser. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { _scoreModel, _topK, _dot, _shortName, MODEL_PREFERENCE };
  }
})();
