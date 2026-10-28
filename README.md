# eslint-rn-plugin-component-order

ESLint rule that keeps the body of React and React Native components (and custom hooks) in one order, so every file reads the same way.

Flat config only (ESLint 9 or 10). No dependencies.

## Install

```sh
npm i -D eslint-rn-plugin-component-order
```

```js
// eslint.config.js
import componentOrder from 'eslint-rn-plugin-component-order';

export default [
  componentOrder.configs.recommended,
  // or, to set options:
  {
    plugins: { 'component-order': componentOrder },
    rules: { 'component-order/component-order': ['error', { customSources: ['^@/', '^\\.'] }] },
  },
];
```

## The order

1. `state`: `useState`, `useReducer`
2. `refs`: `useRef`
3. `custom-hooks`: your own hooks (imported from a relative or `@/`, `~/` path, or declared in the same file)
4. `library-hooks`: every other `use*` (packages, `styles.useVariants`, `useContext`, ...)
5. `callbacks`: `useCallback`
6. `memos`: `useMemo`
7. `functions`: arrow functions and function declarations
8. `effects`: `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useImperativeHandle`
9. `values`: everything else (loose consts used by the JSX)

```tsx
export const Input: FC<InputProps> = ({ value, onChangeText }) => {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { theme } = useUnistyles();
  const change = (next: string) => onChangeText?.(next);
  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);
  if (!theme) return null;
  const color = focused ? theme.colors.primary : theme.colors.border;
  return <TextInput ref={inputRef} onChangeText={change} style={{ color }} />;
};
```

Checked: top-level `const Name = () => {}` (also wrapped in `memo`/`forwardRef`) with a PascalCase name, and top-level `const useName = () => {}` hooks.

### What is allowed

- **Early returns.** `if` statements and the final `return` are not ordered. Put `if (loading) return ...` right after the last hook; hooks cannot follow it (`react-hooks/rules-of-hooks`).
- **Reading what is above.** A statement may stay below something it reads: `const initial = useValue(); const [open] = useState(initial);`.
- **Pinned values.** A value that a hook or function reads is not "loose" and may sit above them: `const bare = ...; styles.useVariants({ bare });`.

### Why effects come after functions

`useImperativeHandle` and effects usually call functions declared in the body. React Compiler's `react-hooks/immutability` rejects reading a function before it is declared, so those hooks go after the functions they use.

### With `no-use-before-define`

The order puts callbacks before the functions they call from inside a closure. Use `variables: false` so closures may refer to later declarations (use inside the same scope still errors):

```js
'@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: false, variables: false }]
```

A callback that runs during render, such as a `useMemo` factory, must not call a function declared below it: that is a temporal dead zone error at runtime.

## Options

```ts
{
  // All nine group names, in the order you want. Default: the list above.
  groups?: ('state' | 'refs' | 'custom-hooks' | 'library-hooks' | 'callbacks' | 'memos' | 'functions' | 'effects' | 'values')[];
  // Regexes matched against the import path; a match makes a hook "custom".
  // Default: ['^\\.', '^@/', '^~/'].
  customSources?: string[];
}
```

## License

MIT
