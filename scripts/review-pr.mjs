#!/usr/bin/env node

/**
 * Pirate Devs — Automated AI Pull Request Reviewer
 *
 * Primary Engine: Google Gemini (Gemini 3.8 Flash / Gemini Flash Latest)
 * Fallback Engine: Groq Cloud (Llama 3 70B)
 *
 * Checks PR diffs for security, zero-storage guarantees, Web Crypto usage,
 * TypeScript typing, and architectural best practices.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const PR_NUMBER = process.env.PR_NUMBER;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!PR_NUMBER) {
  console.error('Missing PR_NUMBER environment variable');
  process.exit(1);
}

if (!GEMINI_API_KEY && !GROQ_API_KEY) {
  console.log('Neither GEMINI_API_KEY nor GROQ_API_KEY configured. Skipping automated review.');
  process.exit(0);
}

const systemPrompt = `You are an expert senior code reviewer for "ChatterRoom", an open-source, zero-storage end-to-end encrypted (E2EE) WebSocket chat app by Pirate Devs.
Your job is to provide concise, friendly, and constructive reviews for open-source contributors.

Guidelines:
1. Check for security flaws:
   - Server must NEVER store or log message plaintext.
   - Keys must only exist in browser memory or URL hash.
   - Web Crypto API (SubtleCrypto) must be used directly.
2. Check for code quality:
   - TypeScript types, error handling, clean modular architecture.
   - No unnecessary dependencies.
3. Be encouraging and respectful: contributors are learning and building together.
4. Conclude with a clear verdict:
   - "✅ **Verdict: Ready to Merge**" OR
   - "⚠️ **Verdict: Changes Requested** (with actionable code fixes)"`;

async function queryGemini(diff) {
  if (!GEMINI_API_KEY) return null;

  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  for (const model of models) {
    try {
      console.log(`🤖 Attempting review with Google Gemini (${model})...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: `Review this Pull Request diff for ChatterRoom:\n\n\`\`\`diff\n${diff}\n\`\`\`` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1000 },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } else {
        const err = await res.text();
        console.warn(`Gemini (${model}) returned non-200:`, err.slice(0, 150));
      }
    } catch (err) {
      console.warn(`Gemini (${model}) fetch error:`, err.message);
    }
  }
  return null;
}

async function queryGroq(diff) {
  if (!GROQ_API_KEY) return null;
  console.log('🤖 Serving review via Groq (Llama-3-70B)...');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Review this Pull Request diff for ChatterRoom:\n\n\`\`\`diff\n${diff.slice(0, 15000)}\n\`\`\`` },
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;
    }
  } catch (err) {
    console.error('Groq fetch error:', err.message);
  }
  return null;
}

async function run() {
  console.log(`🔍 Fetching diff for PR #${PR_NUMBER}...`);
  let diff = '';
  try {
    diff = execSync(`gh pr diff ${PR_NUMBER}`, { maxBuffer: 10 * 1024 * 1024 }).toString();
  } catch (err) {
    console.error('Failed to get PR diff:', err.message);
    process.exit(1);
  }

  if (!diff || diff.trim().length === 0) {
    console.log('No diff found. Skipping review.');
    return;
  }

  // 1. Try Gemini first (deep context & reasoning)
  let review = await queryGemini(diff);

  // 2. Fall back to Groq if Gemini hits 503 high demand or fails
  if (!review) {
    console.log('🔄 Switching to fallback review engine...');
    review = await queryGroq(diff);
  }

  if (!review) {
    console.error('Failed to generate review from all AI providers.');
    return;
  }

  // Post review comment on GitHub PR
  fs.writeFileSync('pr_review.md', review, 'utf8');
  try {
    execSync(`gh pr comment ${PR_NUMBER} --body-file pr_review.md`);
    console.log(`✅ Review posted successfully to PR #${PR_NUMBER}!`);
  } catch (err) {
    console.error('Failed to post PR comment:', err.message);
  } finally {
    if (fs.existsSync('pr_review.md')) fs.unlinkSync('pr_review.md');
  }
}

run().catch(console.error);
