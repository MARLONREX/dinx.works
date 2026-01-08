// server.js
// Backend for DINX — serves frontend + calls Groq LLM + Tavily web search

const express = require('express');
const path = require('path');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================
// 🔑 API KEYS FROM ENV
// ==========================

// LLM provider (Groq)
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Tavily search
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

if (!GROQ_API_KEY) {
  console.warn('⚠️ GROQ_API_KEY is not set. LLM calls will fail.');
}

if (!TAVILY_API_KEY) {
  console.warn('⚠️ TAVILY_API_KEY is not set. Web search will be disabled.');
}

app.use(express.json());

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// ==========================
// 🌐 Decide when to use web
// ==========================
function shouldUseWeb(message) {
  if (!message) return false;
  const text = message.toLowerCase();

  const triggers = [
    'latest',
    'today',
    'current',
    'news',
    'right now',
    'price of',
    'stock',
    'weather',
    'live',
    'update',
    'who is',
    'what is',
    'search',
    'on the internet',
  ];

  return triggers.some((word) => text.includes(word));
}

// ==========================
// 🔍 Tavily web search
// ==========================
async function searchWebWithTavily(query) {
  if (!TAVILY_API_KEY) return '';

  console.log('🌐 Tavily search for:', query);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',    // or "advanced"
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error('Tavily error:', txt);
      return '';
    }

    const data = await response.json();

    const answer = data.answer ? `Answer: ${data.answer}\n\n` : '';

    const results = (data.results || [])
      .slice(0, 3)
      .map((r) => `• ${r.title} — ${r.url}\n${r.content}`)
      .join('\n\n');

    return answer + results;
  } catch (err) {
    console.error('Tavily search failed:', err);
    return '';
  }
}

// ==========================
// 🤖 Main chat endpoint
// ==========================
app.post('/api/chat', async (req, res) => {
  try {
    const { model, system, message } = req.body;

    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not set on server.' });
    }

    if (!model || !message) {
      return res.status(400).json({ error: 'model and message are required.' });
    }

    // 1️⃣ Optionally fetch web info
    let webInfo = '';
    if (shouldUseWeb(message)) {
      webInfo = await searchWebWithTavily(message);
    }

    // 2️⃣ Build messages for the LLM
    const messages = [];

    messages.push({
      role: 'system',
      content:
        system ||
        'You are DINX, a precise, helpful design assistant. Use web context if provided, and say when information may be out of date.',
    });

    if (webInfo) {
      messages.push({
        role: 'system',
        content:
          'Here is information from a live web search. Use it carefully in your answer:\n\n' +
          webInfo,
      });
    }

    messages.push({ role: 'user', content: message });

    // 3️⃣ Call Groq LLM
    const groqRes = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
        }),
      }
    );

    if (!groqRes.ok) {
      const errorText = await groqRes.text();
      console.error('Groq API error:', errorText);
      return res
        .status(500)
        .json({ error: 'Groq API error', details: errorText });
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content || 'No reply from model.';
    res.json({ reply });
  } catch (err) {
    console.error('❌ Server error talking to LLM:', err);
    res.status(500).json({ error: 'Server error talking to LLM.' });
  }
});

// ==========================
// 🚀 Start server
// ==========================
app.listen(PORT, () => {
  console.log(`✅ DINX server listening on http://localhost:${PORT}`);
});
