type Token = { type: 'num'; value: number } | { type: 'id'; value: string } | { type: 'op'; value: string } | { type: 'lp' } | { type: 'rp' } | { type: 'comma' };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const source = expression.trim();
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (char === ' ') { index += 1; continue; }
    if ('+-*,()'.includes(char)) {
      tokens.push(char === '(' ? { type: 'lp' } : char === ')' ? { type: 'rp' } : char === ',' ? { type: 'comma' } : { type: 'op', value: char });
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let raw = '';
      while (index < source.length && /[0-9.]/.test(source[index] ?? '')) { raw += source[index]; index += 1; }
      tokens.push({ type: 'num', value: Number(raw) });
      continue;
    }
    if (/[a-z_]/i.test(char)) {
      let raw = '';
      while (index < source.length && /[a-z0-9_]/i.test(source[index] ?? '')) { raw += source[index]; index += 1; }
      tokens.push({ type: 'id', value: raw });
      continue;
    }
    throw new Error('Expresión no soportada.');
  }
  return tokens;
}

export function evaluate(expression: string, data: Record<string, unknown>): unknown {
  const tokens = tokenize(expression);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const eat = () => tokens[cursor++];
  function parseExpr(): unknown {
    let left = parseTerm();
    while (peek()?.type === 'op' && (peek() as { value: string }).value !== '*') {
      const op = (eat() as { value: string }).value;
      const right = parseTerm();
      const a = Number(left);
      const b = Number(right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      left = op === '+' ? a + b : a - b;
    }
    return left;
  }
  function parseTerm(): unknown {
    let left = parseFactor();
    while (peek()?.type === 'op' && (peek() as { value: string }).value === '*') {
      eat();
      const right = Number(parseFactor());
      const value = Number(left);
      if (!Number.isFinite(value) || !Number.isFinite(right)) return null;
      left = value * right;
    }
    return left;
  }
  function parseFactor(): unknown {
    const token = eat();
    if (!token) throw new Error('Expresión incompleta.');
    if (token.type === 'num') return token.value;
    if (token.type === 'lp') {
      const value = parseExpr();
      if (eat()?.type !== 'rp') throw new Error('Falta paréntesis.');
      return value;
    }
    if (token.type === 'id') {
      if (peek()?.type === 'lp') {
        eat();
        const args: unknown[] = [];
        if (peek()?.type !== 'rp') {
          args.push(parseExpr());
          while (peek()?.type === 'comma') { eat(); args.push(parseExpr()); }
        }
        if (eat()?.type !== 'rp') throw new Error('Falta paréntesis.');
        if (token.value === 'concat') return args.map((arg) => String(arg ?? '')).join('');
        if (token.value === 'days') {
          const start = Date.parse(String(args[0] ?? ''));
          const end = Date.parse(String(args[1] ?? ''));
          if (Number.isNaN(start) || Number.isNaN(end)) return null;
          return Math.round((end - start) / 86_400_000);
        }
        throw new Error('Función no soportada.');
      }
      return data[token.value] ?? null;
    }
    throw new Error('Expresión no soportada.');
  }
  const value = parseExpr();
  if (cursor !== tokens.length) throw new Error('Expresión no soportada.');
  return value;
}
