// Orders the statements at the top level of a component (or custom hook) body
// into groups, so every file reads the same way (names as in `defaultGroups`):
//
//   state > refs > custom-hooks > library-hooks > callbacks > memos
//     > functions > effects > values
//
// - "custom hooks" are `use*` imported from a relative/alias path (or declared
//   in the same file); "library hooks" are every other `use*` (packages,
//   `styles.useVariants`, `useContext`, ...).
// - `useImperativeHandle` and the layout/insertion effects count as effects:
//   they run after the functions they expose, and React Compiler's
//   `react-hooks/immutability` rejects reading a function before it is declared.
// - `if` statements (early returns such as `if (loading) return ...`) and the
//   final `return` are skipped, so a bail-out can sit right after the last
//   hook; hooks cannot follow it anyway (`react-hooks/rules-of-hooks`).
// - A statement that reads something declared by an earlier, later-group
//   statement is allowed to stay after it (`const x = useFoo(); useState(x)`),
//   and a value that a hook or function reads is not "loose": it may sit
//   above them (`const bare = ...; styles.useVariants({ bare })`).

/** Group names in the default order. */
export const defaultGroups = [
  'state',
  'refs',
  'custom-hooks',
  'library-hooks',
  'callbacks',
  'memos',
  'functions',
  'effects',
  'values',
];

const DEFAULT_CUSTOM_SOURCES = ['^\\.', '^@/', '^~/'];

const HOOK_GROUPS = {
  useState: 'state',
  useReducer: 'state',
  useRef: 'refs',
  useCallback: 'callbacks',
  useMemo: 'memos',
  useEffect: 'effects',
  useLayoutEffect: 'effects',
  useInsertionEffect: 'effects',
  useImperativeHandle: 'effects',
};

const isHookName = (name) => /^use[A-Z0-9]/.test(name);
const isComponentName = (name) => /^[A-Z][A-Za-z0-9]*[a-z]/.test(name);
const isFunction = (node) =>
  node?.type === 'ArrowFunctionExpression' ||
  node?.type === 'FunctionExpression';

/** Unwraps `memo(forwardRef(() => ...))`-style wrappers down to the function. */
const unwrap = (node) => {
  let current = node;
  while (current?.type === 'CallExpression' && current.arguments.length > 0) {
    current = current.arguments[0];
  }
  return current;
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce the order of hooks, functions and values in a component body.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          groups: {
            type: 'array',
            items: { enum: defaultGroups },
            uniqueItems: true,
            minItems: defaultGroups.length,
            maxItems: defaultGroups.length,
          },
          customSources: { type: 'array', items: { type: 'string' } },
        },
      },
    ],
    messages: {
      order: '"{{name}}" ({{group}}) goes before "{{other}}" ({{otherGroup}}).',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const [options = {}] = context.options;
    const groups = options.groups ?? defaultGroups;
    const rank = Object.fromEntries(groups.map((name, index) => [name, index]));
    const customSources = (options.customSources ?? DEFAULT_CUSTOM_SOURCES).map(
      (pattern) => new RegExp(pattern)
    );
    const isCustomSource = (source) =>
      customSources.some((pattern) => pattern.test(source));
    const importSources = new Map();
    const localHooks = new Set();

    const hookCallee = (call) => {
      const { callee } = call;
      if (callee.type === 'Identifier' && isHookName(callee.name)) {
        return { name: callee.name, local: callee.name, member: false };
      }
      const isMember =
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.type === 'Identifier' &&
        isHookName(callee.property.name);
      if (isMember) {
        const isReact =
          callee.object.type === 'Identifier' && callee.object.name === 'React';
        return {
          name: callee.property.name,
          local: undefined,
          member: !isReact,
        };
      }
      return undefined;
    };

    const hookGroup = ({ name, local, member }) => {
      if (name in HOOK_GROUPS && !member) return HOOK_GROUPS[name];
      if (member) return 'library-hooks';
      if (localHooks.has(local)) return 'custom-hooks';
      const source = importSources.get(local);
      return source !== undefined && isCustomSource(source)
        ? 'custom-hooks'
        : 'library-hooks';
    };

    const classify = (statement) => {
      if (statement.type === 'FunctionDeclaration') return 'functions';
      if (statement.type === 'ExpressionStatement') {
        const call = statement.expression;
        const hook =
          call.type === 'CallExpression' ? hookCallee(call) : undefined;
        return hook ? hookGroup(hook) : undefined;
      }
      if (statement.type !== 'VariableDeclaration') return undefined;
      const init = statement.declarations[0]?.init;
      if (!init) return 'values';
      if (isFunction(init)) return 'functions';
      const call = init.type === 'AwaitExpression' ? init.argument : init;
      const hook =
        call.type === 'CallExpression' ? hookCallee(call) : undefined;
      return hook ? hookGroup(hook) : 'values';
    };

    const labelOf = (statement) => {
      if (statement.type === 'FunctionDeclaration') {
        return statement.id?.name ?? 'function';
      }
      if (statement.type === 'VariableDeclaration') {
        const [declarator] = statement.declarations;
        return declarator.id.type === 'Identifier'
          ? declarator.id.name
          : sourceCode.getText(declarator.id).replace(/\s+/g, ' ');
      }
      return sourceCode.getText(statement.expression.callee);
    };

    const declaredVariables = (statement) =>
      statement.type === 'VariableDeclaration'
        ? statement.declarations.flatMap((declarator) =>
            sourceCode.getDeclaredVariables(declarator)
          )
        : sourceCode.getDeclaredVariables(statement);

    const reads = (statement, variables) =>
      variables.some((variable) =>
        variable.references.some(
          ({ identifier }) =>
            identifier.range[0] >= statement.range[0] &&
            identifier.range[1] <= statement.range[1]
        )
      );

    const check = (body) => {
      const entries = [];
      for (const statement of body.body) {
        const group = classify(statement);
        if (group === undefined) continue;
        entries.push({
          statement,
          group,
          variables: declaredVariables(statement),
        });
      }

      // A value that a hook or function reads (directly, or through another
      // such value) has to stay above it, so it is not "loose" and does not
      // hold anything back.
      const pinned = new Set();
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        const feedsLater = entries.some(
          (later, laterIndex) =>
            laterIndex > index &&
            (later.group !== 'values' || pinned.has(laterIndex)) &&
            reads(later.statement, entry.variables)
        );
        if (entry.group === 'values' && feedsLater) {
          pinned.add(index);
        }
      }
      const isPinned = (entry, index) => pinned.has(index);

      entries.forEach((entry, index) => {
        const higher = entries
          .slice(0, index)
          .filter(
            (earlier, earlierIndex) =>
              rank[earlier.group] > rank[entry.group] &&
              !isPinned(earlier, earlierIndex)
          );
        const needed = higher.some((earlier) =>
          reads(entry.statement, earlier.variables)
        );
        if (higher.length === 0 || needed) return;
        const [other] = higher;
        context.report({
          node: entry.statement,
          messageId: 'order',
          data: {
            name: labelOf(entry.statement),
            group: entry.group,
            other: labelOf(other.statement),
            otherGroup: other.group,
          },
        });
      });
    };

    const visitFunction = (node, name) => {
      const fn = unwrap(node);
      if (!isFunction(fn)) return;
      if (isHookName(name)) localHooks.add(name);
      if (fn.body.type !== 'BlockStatement') return;
      check(fn.body);
    };

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          importSources.set(specifier.local.name, node.source.value);
        }
      },
      // Top-level only: nested functions are callbacks, not components.
      'Program > VariableDeclaration, Program > ExportNamedDeclaration > VariableDeclaration'(
        node
      ) {
        for (const declarator of node.declarations) {
          const { id } = declarator;
          if (id.type !== 'Identifier') continue;
          if (isComponentName(id.name) || isHookName(id.name)) {
            visitFunction(declarator.init, id.name);
          }
        }
      },
    };
  },
};
