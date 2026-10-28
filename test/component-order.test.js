import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import plugin from '../src/index.js';

RuleTester.describe = describe;
RuleTester.it = it;

const rule = plugin.rules['component-order'];
const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const component = (imports, body) => `${imports}
export const Sample = () => {
${body}
  return null;
};
`;

tester.run('component-order', rule, {
  valid: [
    {
      name: 'the documented order',
      code: component(
        `import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from './useTheme';
import { useWindowDimensions } from 'react-native';`,
        `  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const total = useMemo(() => width * 2, [width]);
  const press = () => toggle();
  useEffect(() => {
    press();
  }, [total]);
  if (!theme) return null;
  const label = open ? 'open' : 'closed';`
      ),
    },
    {
      name: 'a statement may stay below what it reads',
      code: component(
        `import { useState } from 'react';
import { useValue } from './useValue';`,
        `  const initial = useValue();
  const [open] = useState(initial);`
      ),
    },
    {
      name: 'a value that a hook reads is not loose',
      code: component(
        `import { useUnistyles } from 'react-native-unistyles';`,
        `  const bare = type === 'bare';
  styles.useVariants({ bare });
  const { theme } = useUnistyles();
  const press = () => String(bare);`
      ),
    },
    {
      name: 'useImperativeHandle is an effect',
      code: component(
        `import { useImperativeHandle } from 'react';`,
        `  const focus = () => {};
  useImperativeHandle(ref, () => ({ focus }));
  const label = 'x';`
      ),
    },
    {
      name: 'an early return is not ordered',
      code: component(
        `import { useEffect } from 'react';`,
        `  useEffect(() => {}, []);
  if (loading) return null;
  const label = 'x';`
      ),
    },
    {
      name: 'hooks are checked too',
      code: `import { useState } from 'react';
export const useSample = () => {
  const [a] = useState(1);
  const read = () => a;
  return read;
};
`,
    },
    {
      name: 'functions that are not components are left alone',
      code: `export const helper = () => {
  const run = () => 1;
  const [a] = useState(1);
  return run;
};
`,
    },
    {
      name: 'wrapped components are checked',
      code: `import { forwardRef, useState } from 'react';
export const Sample = forwardRef((props, ref) => {
  const [a] = useState(1);
  const read = () => a;
  return null;
});
`,
    },
    {
      name: 'custom order',
      options: [
        {
          groups: [
            'functions',
            'state',
            'refs',
            'custom-hooks',
            'library-hooks',
            'callbacks',
            'memos',
            'effects',
            'values',
          ],
        },
      ],
      code: component(
        `import { useState } from 'react';`,
        `  const press = () => 1;
  const [open] = useState(false);`
      ),
    },
  ],
  invalid: [
    {
      name: 'a hook below a function',
      code: component(
        `import { useState } from 'react';`,
        `  const press = () => {};
  const [open] = useState(false);`
      ),
      errors: [
        {
          messageId: 'order',
          data: {
            name: '[open]',
            group: 'state',
            other: 'press',
            otherGroup: 'functions',
          },
        },
      ],
    },
    {
      name: 'a library hook above a custom hook',
      code: component(
        `import { useWindowDimensions } from 'react-native';
import { useTheme } from '../useTheme';`,
        `  const { width } = useWindowDimensions();
  const theme = useTheme();`
      ),
      errors: [{ messageId: 'order' }],
    },
    {
      name: 'a hook declared in the file is a custom hook',
      code: `import { useWindowDimensions } from 'react-native';
const useLocal = () => 1;
export const Sample = () => {
  const { width } = useWindowDimensions();
  const local = useLocal();
  return null;
};
`,
      errors: [{ messageId: 'order' }],
    },
    {
      name: 'an effect above a function',
      code: component(
        `import { useEffect } from 'react';`,
        `  useEffect(() => {}, []);
  const press = () => {};`
      ),
      errors: [{ messageId: 'order' }],
    },
    {
      name: 'a loose value above a hook it does not feed',
      code: component(
        `import { useState } from 'react';`,
        `  const label = 'x';
  const [open] = useState(false);`
      ),
      errors: [{ messageId: 'order' }],
    },
    {
      name: 'customSources decides what a custom hook is',
      options: [{ customSources: ['^@acme/'] }],
      code: component(
        `import { useAcme } from '@acme/hooks';
import { useOther } from './useOther';`,
        `  const other = useOther();
  const acme = useAcme();`
      ),
      errors: [{ messageId: 'order' }],
    },
  ],
});
