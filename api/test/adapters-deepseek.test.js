import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const deepseek = (await import('../coach/core/adapters/deepseek.js')).default;
const { DEEPSEEK_OUTPUT_FLOOR } = await import('../coach/core/adapters/deepseek.js');
const { HTTP_PROVIDERS, providerOfKey, priceTier, baseUrlFor } = await import('../coach/core/providers.js');
const { attemptOnce } = await import('../coach/core/pipeline.js');

const ANSWER = '{"coach_contract":1,"nochange":true,"reading":"fine"}';
const env = { DEEPSEEK_API_KEY: 'test-key' };
const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } } };

function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const a = typeof answers === 'function' ? answers(calls.length, url, init) : answers[Math.min(calls.length, answers.length) - 1];
    if (a instanceof Error) throw a;
    const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    return { ok: a.status >= 200 && a.status < 300, status: a.status, text: async () => text };
  };
  f.calls = calls;
  return f;
}
const ok = body => ({ status: 200, body });
const chat = content => ok({ choices: [{ message: { content }, finish_reason: 'stop' }] });

test('DeepSeek is a plain HTTPS provider with its own base, key and starting model', () => {
  const meta = HTTP_PROVIDERS.deepseek;
  assert.equal(meta.label, 'DeepSeek API');
  assert.equal(meta.http, true);
  assert.equal(meta.apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(meta.defaultBase, 'https://api.deepseek.com');
  assert.equal(meta.defaultModel, 'deepseek-flash');
  assert.equal(meta.baseUrl, undefined, 'the base is fixed, not something the person types');
  assert.equal(meta.keyOptional, undefined);
  assert.equal(baseUrlFor('deepseek', {}), 'https://api.deepseek.com');
  assert.equal(providerOfKey('sk-' + 'ab'.repeat(16)), 'deepseek');
  assert.equal(providerOfKey('sk-' + 'AB'.repeat(16)), 'deepseek');
  assert.equal(providerOfKey('sk-proj-' + 'b'.repeat(40)), 'openai');
  assert.equal(providerOfKey('sk-' + 'B'.repeat(40)), 'openai');
  assert.equal(priceTier('deepseek-flash'), 'low');
  assert.equal(priceTier('deepseek-v4-pro'), 'high');
});

test('DeepSeek calls its default model with the key, and does not think when no job is named', async () => {
  const f = fakeFetch([chat(ANSWER)]);
  const result = await deepseek.invoke({ cfg: {}, prompt: 'P', env, fetch: f });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.text, ANSWER);
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer test-key');
  assert.equal(c.body.model, HTTP_PROVIDERS.deepseek.defaultModel);
  assert.equal(c.body.temperature, 0);
  assert.equal(c.body.stream, true);
  assert.ok('max_tokens' in c.body);
  assert.equal('max_completion_tokens' in c.body, false);
  assert.deepEqual(c.body.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in c.body, false);
  assert.ok(!c.url.includes('test-key'));
});

test('every job, including a plan, is sent with thinking off and a high output floor', async () => {
  for (const kind of ['create', 'review', 'ask', 'debrief', 'adapt', null]) {
    const f = fakeFetch([chat(ANSWER)]);
    await deepseek.invoke({ cfg: {}, prompt: 'P', env, model: 'deepseek-v4-pro', kind, schema: SCHEMA, maxTokens: 16000, fetch: f });
    assert.equal(f.calls[0].body.model, 'deepseek-v4-pro');
    assert.deepEqual(f.calls[0].body.thinking, { type: 'disabled' });
    assert.equal('reasoning_effort' in f.calls[0].body, false);
    assert.equal(f.calls[0].body.max_tokens, DEEPSEEK_OUTPUT_FLOOR);
    assert.deepEqual(f.calls[0].body.response_format, { type: 'json_object' });
  }
});

test('a refine is a create job and still does not think', async () => {
  const f = fakeFetch([chat(ANSWER)]);
  await attemptOnce({ adapter: deepseek, cfg: {}, kind: 'create', payload: { refine: 'swap the press' }, invokeOpts: { env, fetch: f, maxTokens: 16000 } });
  assert.deepEqual(f.calls[0].body.thinking, { type: 'disabled' });
  assert.equal(f.calls[0].body.max_tokens, DEEPSEEK_OUTPUT_FLOOR);
});

test('the pipeline is what tells DeepSeek which job this is', async () => {
  const ask = fakeFetch([chat('{"coach_contract":1,"answer":"Rest tomorrow."}')]);
  const a = await attemptOnce({ adapter: deepseek, cfg: {}, kind: 'ask', payload: {}, invokeOpts: { env, fetch: ask } });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(ask.calls.length, 1);
  assert.deepEqual(ask.calls[0].body.thinking, { type: 'disabled' });
  assert.ok(ask.calls[0].body.max_tokens >= DEEPSEEK_OUTPUT_FLOOR);

  const review = fakeFetch([chat(ANSWER)]);
  const r = await attemptOnce({ adapter: deepseek, cfg: {}, kind: 'review', payload: { plan: { routines: [], week: {} } }, invokeOpts: { env, fetch: review } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(review.calls[0].body.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in review.calls[0].body, false);
  assert.ok(review.calls[0].body.max_tokens >= DEEPSEEK_OUTPUT_FLOOR);
  assert.deepEqual(review.calls[0].body.response_format, { type: 'json_object' });
});

test('List models returns the ids the API actually serves, with no aliases added', async () => {
  const f = fakeFetch([ok({ object: 'list', data: [
    { id: 'deepseek-v4-pro', object: 'model' },
    { id: 'deepseek-flash', object: 'model' },
    { id: 'some-future-model', object: 'model' }
  ] })]);
  const r = await deepseek.models({}, env, { fetch: f });
  assert.equal(r.ok, true, r.error);
  assert.equal(f.calls[0].url, 'https://api.deepseek.com/v1/models');
  assert.equal(f.calls[0].headers.authorization, 'Bearer test-key');
  assert.deepEqual(r.models, ['deepseek-flash', 'deepseek-v4-pro', 'some-future-model']);
  assert.equal(r.models.includes('deepseek-chat'), false);
  assert.equal(r.models.includes('deepseek-reasoner'), false);
});

test('the answer is the message content, not the reasoning trace, including a stream', async () => {
  const traced = ok({ choices: [{ message: { content: ANSWER, reasoning_content: '{"not":"the answer"}' }, finish_reason: 'stop' }] });
  const plain = await deepseek.invoke({ cfg: {}, prompt: 'P', env, fetch: fakeFetch([traced]), stream: false });
  assert.equal(plain.text, ANSWER);

  const sse = [
    'data: {"choices":[{"delta":{"reasoning_content":"{\\"not\\":\\"the answer\\"}"}}]}',
    'data: {"choices":[{"delta":{"content":"{\\"coach_contract\\":1,"}}]}',
    'data: {"choices":[{"delta":{"content":"\\"nochange\\":true,\\"reading\\":\\"fine\\"}"},"finish_reason":"stop"}]}',
    'data: [DONE]',
    ''
  ].join('\n\n');
  const f = fakeFetch([{ status: 200, body: sse }]);
  const streamed = await deepseek.invoke({ cfg: {}, prompt: 'P', env, kind: 'ask', fetch: f });
  assert.equal(streamed.code, 0, streamed.stderr);
  assert.equal(streamed.text, ANSWER);
  assert.equal(f.calls[0].body.stream, true);
  assert.deepEqual(f.calls[0].body.thinking, { type: 'disabled' });
});
