/**
 * Metris AI chat API. Answers questions using only the provided knowledge-base context.
 * Set OPENAI_API_KEY in Vercel (or .env locally) to enable. Without it, returns a friendly fallback.
 */

const MAX_CONTEXT_ITEMS = 5;
const MAX_BODY_LENGTH = 2800;

function buildSystemPrompt(context) {
  const blocks = (context || [])
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((item) => {
      const body = (item.body || '').slice(0, MAX_BODY_LENGTH);
      return `## ${item.title || 'Article'}\n${body}`;
    });
  const refs = blocks.join('\n\n---\n\n');
  return `You are Metris AI, the support assistant for Metris Energy's solar asset management platform. Answer the user's question using ONLY the following knowledge base articles. If the answer is not in these articles, say so and suggest they browse the knowledge base or contact support@metrisenergy.com. Keep answers concise and helpful. Do not make up information.\n\n${refs || 'No articles were provided.'}`;
}

async function callOpenAI(apiKey, question, context) {
  const systemPrompt = buildSystemPrompt(context);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(res.status === 429 ? 'Rate limit' : err || res.statusText);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Invalid response from OpenAI');
  return content.trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(200).json({
      reply: "Metris AI isn't configured for this environment. Please browse the articles above or email support@metrisenergy.com.",
    });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch (_) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const context = Array.isArray(body.context) ? body.context : [];

  if (!question) {
    res.status(400).json({ error: 'Missing question' });
    return;
  }

  try {
    const reply = await callOpenAI(apiKey, question, context);
    res.status(200).json({ reply });
  } catch (e) {
    console.error('Chat API error:', e.message);
    res.status(500).json({
      reply: 'Sorry, I had trouble answering that. Please try again or contact support@metrisenergy.com.',
    });
  }
};
