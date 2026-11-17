/* DeepSeek Chat Completions (https://api.deepseek.com).
 *
 * Same wire shape as OpenAI. The documented base has no /v1 on it, and both
 * /v1/chat/completions and /chat/completions answer, so this uses the shared /v1 paths.
 * GET /v1/models is the picker: model ids get retired (deepseek-chat, deepseek-reasoner),
 * so nothing here keeps a list of aliases. defaultModel is only where a fresh setup starts.
 *
 * Thinking is on unless the request says otherwise, at effort "high", and that chain of
 * thought is counted against max_tokens. A plan that thinks inside a 16k ceiling comes
 * back as "cut off at the output limit" with the JSON still unwritten. Every Coach job
 * therefore sends thinking off, and the output ceiling is at least OUTPUT_FLOOR so a
 * phone that still has the old 16000 dial cannot truncate the answer. The final JSON is
 * read from message content; reasoning_content is not the answer.
 * response_format accepts text or json_object, not a JSON schema.
 */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

// DeepSeek allows up to 384k output tokens. 65536 is this app's own ceiling, and enough
// for a week plan once thinking is not spending the budget.
export const DEEPSEEK_OUTPUT_FLOOR = 65536;

const base = chatCompletionsSpec('deepseek', { maxTokensField: 'max_tokens', temperature: 0 });

export const deepseekSpec = {
  ...base,
  body: at => {
    const body = base.body(at);
    // DeepSeek's enum is text | json_object. A json_schema body is a 400, and the
    // compatibility ladder would only find that out after a wasted call.
    if (body.response_format && body.response_format.type === 'json_schema') body.response_format = { type: 'json_object' };
    const field = 'max_tokens' in body ? 'max_tokens' : 'max_completion_tokens' in body ? 'max_completion_tokens' : 'max_tokens';
    body[field] = Math.max(Number(body[field]) || 0, DEEPSEEK_OUTPUT_FLOOR);
    // Do not send reasoning_effort: with thinking disabled it must not turn thinking back on.
    const { reasoning_effort: _effort, ...rest } = body;
    return { ...rest, thinking: { type: 'disabled' } };
  }
};

export default httpAdapter(deepseekSpec);
