// output.mjs —— DSH 工具输出契约（schema + render），所有 moxi_* 共用

export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tool: { type: 'string' },
    result: { type: 'object', additionalProperties: true },
    images: { type: 'array', items: { type: 'object', additionalProperties: true } },
    imageStatus: { type: 'string' },
  },
  required: ['tool', 'result', 'images', 'imageStatus'],
};

/**
 * 宿主的 render 调用约定在不同版本里有两种：`render(value)` 或 `render(args, value)`。
 * 这里不猜顺序：取参数里第一个带 tool 字段的对象当输出值，都取不到就用最后一个参数。
 */
export function render(...args) {
  const value = args.find((a) => a && typeof a === 'object' && 'tool' in a) ?? args[args.length - 1] ?? {};
  const content = [{
    type: 'text',
    text: JSON.stringify({ tool: value?.tool ?? '', ...(value?.result ?? {}), imageStatus: value?.imageStatus ?? '' }, null, 2),
  }];
  for (const attachment of value?.images ?? []) content.push({ type: 'image', attachment });
  return content;
}

export function ok(tool, result = {}, images = [], imageStatus = '本次操作没有采集画面。') {
  return { tool, result: { ok: true, ...result }, images, imageStatus };
}

export function fail(tool, error, extra = {}) {
  return { tool, result: { ok: false, error: String(error ?? 'unknown').slice(0, 800), ...extra }, images: [], imageStatus: '本次操作没有采集画面。' };
}

/** 未接线的能力：说清缺什么，而不是静默失败 */
export function notConnected(tool, need, hint) {
  return {
    tool,
    result: { ok: false, code: 'not-connected', need, error: hint },
    images: [],
    imageStatus: '本次操作没有采集画面。',
  };
}
