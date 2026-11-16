// tools.mjs —— 把动作目录变成 DSH 工具定义
import { ACTIONS, toolName } from './catalog.mjs';
import { OUTPUT_SCHEMA, render } from './output.mjs';

function parametersFor(spec) {
  const properties = spec.params ?? {};
  return { type: 'object', properties, additionalProperties: false };
}

export function buildToolDefinitions(dispatch, { prefix = 'moxi', version = '0.1.0' } = {}) {
  return ACTIONS.map((spec) => {
    const name = toolName(spec.name, prefix);
    const guard = spec.outbound ? '【会真的发出去】' : spec.mutating ? '【会改状态】' : '';
    const desc = `[moxi] ${guard}${spec.summary}`;
    return {
      name,
      description: desc,
      parameters: parametersFor(spec),
      timeoutMs: spec.needs === 'local' ? 30000 : 120000,
      output: { schema: OUTPUT_SCHEMA, render },
      async execute(args = {}) {
        return dispatch(spec.name, args ?? {});
      },
    };
  });
}
