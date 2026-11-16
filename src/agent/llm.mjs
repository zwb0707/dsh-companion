// llm.mjs —— 用 DSH 的 ctx.llm.stream 跑一次模型调用（进程内，无 HTTP）
//
// 只依赖 llm.stream(GenerateOptions) → AsyncIterable<StreamChunk>：
//   text-delta 累加文本，usage 记用量，finish 判断成功/失败。

export function createLlmRunner({ llm, config = {}, log = () => {} } = {}) {
  const available = typeof llm?.stream === 'function';

  async function run({ system, messages, maxTokens, temperature, signal, provider, model, purpose = 'moxi' } = {}) {
    if (!available) throw Object.assign(new Error('当前 profile 没有 llm 服务'), { code: 'LLM_UNAVAILABLE' });
    const route = {
      provider: provider ?? config.provider,
      model: model ?? config.model,
    };
    if (!route.provider || !route.model) throw Object.assign(new Error('没有配置 provider/model'), { code: 'LLM_UNCONFIGURED' });

    let text = '';
    let usage = null;
    let finish = null;
    for await (const chunk of llm.stream({
      ...route, system, messages, maxTokens, temperature, signal, purpose,
    })) {
      if (chunk?.type === 'text-delta') text += chunk.text ?? '';
      else if (chunk?.type === 'usage') usage = chunk.usage ?? usage;
      else if (chunk?.type === 'finish') {
        finish = chunk.reason ?? null;
        if (finish?.kind === 'error') throw Object.assign(new Error(finish.failure?.message ?? '模型调用失败'), { code: finish.failure?.code ?? 'LLM_ERROR' });
        if (finish?.kind === 'aborted') throw Object.assign(new Error('模型调用被取消'), { code: 'LLM_ABORTED' });
      }
    }
    if (!text.trim()) log('[agent] 模型返回空文本');
    return { text: text.trim(), usage, finishKind: finish?.kind ?? 'stop', route };
  }

  return { available, run, route: () => ({ ...config }) };
}
