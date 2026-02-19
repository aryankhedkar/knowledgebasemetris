/**
 * Metris AI chat API (streaming). Answers questions using only the provided knowledge-base context.
 * Set OPENAI_API_KEY in Vercel (or .env locally) to enable.
 */

const MAX_CONTEXT_ITEMS = 5;
const MAX_BODY_LENGTH = 2800;
const MAX_HISTORY = 10;

function buildSystemPrompt(context) {
  const blocks = (context || [])
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((item, i) => {
      const body = (item.body || '').slice(0, MAX_BODY_LENGTH);
      return `## [Article ${i + 1}] ${item.title || 'Article'}\n${body}`;
    });
  const refs = blocks.join('\n\n---\n\n');
  return `You are Metris AI, a friendly and knowledgeable support assistant for Metris Energy, a solar asset management platform used by asset managers, O&M providers, and their customers.

Your personality:
- Warm, approachable, and genuinely helpful. Like a knowledgeable colleague, not a robot
- Use natural, conversational language. Say "you" and "your", not "the user"
- Keep things clear and concise, but don't be cold or overly formal
- It's fine to say "Great question!" or "Happy to help with that" when it feels natural, but don't overdo it
- If something is a common question, reassure them it comes up a lot
- Use short paragraphs. Break up longer answers so they're easy to scan

Writing style:
- Never use em dashes. Use commas, full stops, or separate sentences instead
- Never use the word "actually"
- Avoid dramatic or exaggerated language. No "incredibly", "absolutely", "game-changing", "revolutionary", etc. Just be straightforward and genuine
- NEVER use LaTeX, MathJax, or any math notation like \[ \], \text{}, \frac{}, etc. Write all formulas in plain text, e.g. "CO2 Savings = Generation (kWh) x 0.207074 (kg CO2/kWh)". The chat has no math renderer so LaTeX will show as raw ugly text
- For subscripts like CO2, just write CO2 in plain text
- When writing numbered lists, use standard markdown: "1. First item\n2. Second item\n3. Third item" with no blank lines between items

Source citations:
- At the end of your answer, on a new line, add a "Sources:" section listing the article titles you drew from
- Format each source as: Sources: Article Title 1, Article Title 2
- Only cite articles you used. If you didn't use any, skip the Sources line

Honesty and uncertainty:
- Answer ONLY from the knowledge base articles provided below. Do not invent or assume information
- If you are not 100% sure about something, say so clearly. Use phrases like "I'm not certain about this" or "I don't have the detail on that" rather than guessing
- NEVER make up an answer. It is far better to say you don't know than to give wrong information
- If the answer isn't covered in the articles, or you're only partially confident, tell them honestly and direct them to email support@metrisenergy.com for a definitive answer
- When you're uncertain, always end with something like: "For a definitive answer, I'd recommend emailing support@metrisenergy.com directly. The team typically responds within 2 hours."
- Never fabricate features, numbers, formulas, or processes. If a specific number or detail isn't in the articles, don't guess it
- You have conversation history, so handle follow-up questions naturally

Knowledge base articles:

${refs || 'No articles were provided.'}`;
}

function buildMessages(systemPrompt, question, history) {
  const messages = [{ role: 'system', content: systemPrompt }];
  const recent = (history || []).slice(-MAX_HISTORY);
  for (const msg of recent) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({ role: msg.role, content: String(msg.content || '').slice(0, 2000) });
    }
  }
  messages.push({ role: 'user', content: question });
  return messages;
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
  const history = Array.isArray(body.history) ? body.history : [];

  if (!question) {
    res.status(400).json({ error: 'Missing question' });
    return;
  }

  const systemPrompt = buildSystemPrompt(context);
  const messages = buildMessages(systemPrompt, question, history);

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        max_tokens: 1024,
        temperature: 0.5,
        stream: true,
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      console.error('OpenAI error:', openaiRes.status, err);
      res.status(200).json({
        reply: 'Sorry, I had trouble answering that. Please try again or contact support@metrisenergy.com.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = openaiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          res.write('data: [DONE]\n\n');
          break;
        }
        try {
          const parsed = JSON.parse(payload);
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        } catch (_) {}
      }
    }
    res.end();
  } catch (e) {
    console.error('Chat API error:', e.message);
    res.status(200).json({
      reply: 'Sorry, I had trouble answering that. Please try again or contact support@metrisenergy.com.',
    });
  }
};
