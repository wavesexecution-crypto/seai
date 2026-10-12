#!/usr/bin/env tsx
/**
 * One-off verification call against the Experiential gateway.
 *
 * Confirms claude-fable-5.1 is routed to https://api.experientiallabs.ai/v1
 * with the EXPLABS_API_KEY, and prints the model's reply plus token usage.
 *
 * Usage:
 *   npx tsx scripts/test-explabs.ts
 *   npx tsx scripts/test-explabs.ts "your prompt here"
 */
import { config } from '../src/config.js';
import { experChat, isExperModel } from '../src/ai/gateway.js';

async function main() {
  const model = 'claude-fable-5.1';
  if (!isExperModel(model)) {
    console.error(`[test-explabs] expected isExperModel("${model}") to be true`);
    process.exit(1);
  }

  if (!config.experKey) {
    console.error(
      '\n[test-explabs] EXPLABS_API_KEY is not set.\n' +
      'Create one under Settings -> API keys, then export it or add it to .env:\n' +
      '  EXPLABS_API_KEY=xpl_...\n'
    );
    process.exit(2);
  }

  const prompt = process.argv.slice(2).join(' ') || 'Reply with exactly: "Experiential gateway OK"';

  console.log(`[test-explabs] base URL : ${config.experBaseUrl}`);
  console.log(`[test-explabs] model    : ${model}`);
  console.log(`[test-explabs] key      : ${config.experKey.slice(0, 8)}… (masked)`);
  console.log(`[test-explabs] prompt   : ${prompt}\n`);

  const started = Date.now();
  const out = await experChat(
    [
      { role: 'system', content: 'You are a concise assistant. Answer directly.' },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 200, timeoutMs: 60_000 }
  );
  const latencyMs = Date.now() - started;

  console.log('--- reply ---');
  console.log(out.content.trim());
  console.log('--- usage ---');
  console.log(JSON.stringify(out.usage ?? null, null, 2));
  console.log(`--- latency: ${latencyMs} ms ---`);
}

main().catch((e) => {
  console.error(`\n[test-explabs] FAILED: ${e?.message ?? e}`);
  process.exit(1);
});