import componentOrder, { defaultGroups } from './rules/component-order.js';

const plugin = {
  meta: { name: 'eslint-rn-plugin-component-order', version: '0.1.0' },
  rules: { 'component-order': componentOrder },
  configs: {},
};

plugin.configs.recommended = {
  plugins: { 'component-order': plugin },
  rules: { 'component-order/component-order': 'error' },
};

export { defaultGroups };
export default plugin;
