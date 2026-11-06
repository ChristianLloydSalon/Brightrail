/**
 * Safe formula language for the Formula step. A small hand-written parser and evaluator, with no `eval`,
 * no `Function` and no access to anything except the run data passed in. Lookups only read an object's
 * own properties, and `__proto__`, `constructor` and `prototype` are always undefined, so prototypes can't
 * be reached. Expression length, nesting depth, evaluation steps and output size are capped.
 *
 *   total * 1.08                         order.items[0].price
 *   if(amount > 100, "large", "small")    concat(upper(first_name), " ", last_name)
 *   round(sum(prices) / count(prices), 2) formatDate(addDays(now(), 7), "YYYY-MM-DD")
 */

export class FormulaError extends Error {
  constructor(message: string, readonly position?: number) {
    super(position === undefined ? message : `${message} (at character ${position + 1})`);
    this.name = "FormulaError";
  }
}

const MAX_LENGTH = 2000;
const MAX_DEPTH = 40;
const MAX_STEPS = 20_000;
const MAX_STRING = 100_000;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

type Tok =
  | { t: "num"; v: number; p: number }
  | { t: "str"; v: string; p: number }
  | { t: "id"; v: string; p: number }
  | { t: "op"; v: string; p: number }
  | { t: "eof"; p: number };

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new FormulaError(`Formulas can be at most ${MAX_LENGTH} characters.`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), p: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1]!;
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new FormulaError("Text is missing its closing quote.", i);
      out.push({ t: "str", v: s, p: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two, p: i }); i += 2; continue; }
    if ("+-*/%<>!()[],.".includes(c)) { out.push({ t: "op", v: c, p: i }); i++; continue; }
    if (c === "=") throw new FormulaError("Use == to compare values.", i);
    throw new FormulaError(`Unexpected character “${c}”.`, i);
  }
  out.push({ t: "eof", p: src.length });
  return out;
}

type Node =
  | { k: "lit"; v: unknown }
  | { k: "path"; root: string; parts: Array<string | Node>; p: number }
  | { k: "call"; name: string; args: Node[]; p: number }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node; p: number };

function parse(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  let depth = 0;
  const peek = () => toks[i]!;
  const isOp = (v: string) => { const t = peek(); return t.t === "op" && t.v === v; };
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected “${v}”.`, peek().p);
    i++;
  };
  const enter = () => { if (++depth > MAX_DEPTH) throw new FormulaError("The formula is nested too deeply."); };

  const binary = (ops: string[], next: () => Node) => (): Node => {
    let a = next();
    while (peek().t === "op" && ops.includes((peek() as { v: string }).v)) {
      const t = toks[i++] as { v: string; p: number };
      a = { k: "bin", op: t.v, a, b: next(), p: t.p };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp("!") || isOp("-")) {
      const op = (toks[i++] as { v: string }).v;
      enter();
      const a = unary();
      depth--;
      return { k: "un", op, a };
    }
    return postfix();
  };
  const primary = (): Node => {
    const t = peek();
    if (t.t === "num" || t.t === "str") { i++; return { k: "lit", v: t.v }; }
    if (isOp("(")) {
      i++;
      enter();
      const e = orExpr();
      depth--;
      expect(")");
      return e;
    }
    if (t.t === "id") {
      i++;
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      if (isOp("(")) {
        i++;
        enter();
        const args: Node[] = [];
        if (!isOp(")")) {
          do args.push(orExpr());
          while (isOp(",") && ++i);
        }
        depth--;
        expect(")");
        if (!FUNCTIONS[t.v.toLowerCase()]) throw new FormulaError(`Unknown function “${t.v}”. ${suggest(t.v)}`, t.p);
        return { k: "call", name: t.v.toLowerCase(), args, p: t.p };
      }
      return { k: "path", root: t.v, parts: [], p: t.p };
    }
    if (t.t === "eof") throw new FormulaError("The formula ends too early.", t.p);
    throw new FormulaError(`Unexpected “${(t as { v: string }).v}”.`, t.p);
  };
  const postfix = (): Node => {
    let n = primary();
    while (isOp(".") || isOp("[")) {
      if (n.k !== "path") throw new FormulaError("Only fields can use . or [ ].", peek().p);
      if (isOp(".")) {
        i++;
        const t = peek();
        if (t.t !== "id") throw new FormulaError("Expected a field name after “.”.", t.p);
        i++;
        n.parts.push(t.v);
      } else {
        i++;
        enter();
        n.parts.push(orExpr());
        depth--;
        expect("]");
      }
    }
    return n;
  };
  const mul = binary(["*", "/", "%"], unary);
  const add = binary(["+", "-"], mul);
  const cmp = binary(["<", "<=", ">", ">="], add);
  const eq = binary(["==", "!="], cmp);
  const andExpr = binary(["&&"], eq);
  const orExpr: () => Node = binary(["||"], andExpr);

  const root = orExpr();
  if (peek().t !== "eof") throw new FormulaError(`Unexpected “${(peek() as { v?: string }).v ?? ""}”.`, peek().p);
  return root;
}

/* ---------------- values & functions ---------------- */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const toNum = (v: unknown, fn: string): number => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "boolean" ? Number(v) : v;
  if (!isNum(n)) throw new FormulaError(`${fn} needs a number, got ${show(v)}.`);
  return n;
};
const toText = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const toList = (v: unknown, fn: string): unknown[] => {
  if (Array.isArray(v)) return v;
  throw new FormulaError(`${fn} needs a list, got ${show(v)}.`);
};
const toDate = (v: unknown, fn: string): Date => {
  const d = v instanceof Date ? v : typeof v === "number" ? new Date(v) : typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new FormulaError(`${fn} needs a date, got ${show(v)}.`);
  return d;
};
const truthy = (v: unknown) => !(v === false || v === null || v === undefined || v === 0 || v === "" || (Array.isArray(v) && v.length === 0));
function show(v: unknown) {
  const s = v === undefined ? "nothing (the field doesn't exist)" : JSON.stringify(v) ?? String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

type Fn = { min: number; max: number; fn: (a: unknown[]) => unknown; help: string };
const FUNCTIONS: Record<string, Fn> = {
  // logic
  if: { min: 3, max: 3, fn: ([c, a, b]) => (truthy(c) ? a : b), help: "if(condition, then, else)" },
  coalesce: { min: 1, max: 20, fn: (a) => a.find((v) => v !== undefined && v !== null && v !== "") ?? null, help: "coalesce(a, b, …) — first non-empty value" },
  isempty: { min: 1, max: 1, fn: ([v]) => !truthy(v) && v !== 0 && v !== false, help: "isEmpty(value)" },
  not: { min: 1, max: 1, fn: ([v]) => !truthy(v), help: "not(value)" },
  // text
  upper: { min: 1, max: 1, fn: ([v]) => toText(v).toUpperCase(), help: "upper(text)" },
  lower: { min: 1, max: 1, fn: ([v]) => toText(v).toLowerCase(), help: "lower(text)" },
  trim: { min: 1, max: 1, fn: ([v]) => toText(v).trim(), help: "trim(text)" },
  len: { min: 1, max: 1, fn: ([v]) => (Array.isArray(v) ? v.length : toText(v).length), help: "len(text or list)" },
  concat: { min: 1, max: 50, fn: (a) => a.map(toText).join(""), help: "concat(a, b, …)" },
  replace: { min: 3, max: 3, fn: ([t, f, w]) => toText(t).split(toText(f)).join(toText(w)), help: "replace(text, find, with) — replaces every match" },
  contains: { min: 2, max: 2, fn: ([t, s]) => (Array.isArray(t) ? t.some((x) => x === s) : toText(t).includes(toText(s))), help: "contains(text or list, value)" },
  startswith: { min: 2, max: 2, fn: ([t, s]) => toText(t).startsWith(toText(s)), help: "startsWith(text, prefix)" },
  endswith: { min: 2, max: 2, fn: ([t, s]) => toText(t).endsWith(toText(s)), help: "endsWith(text, suffix)" },
  left: { min: 2, max: 2, fn: ([t, n]) => toText(t).slice(0, Math.max(0, toNum(n, "left"))), help: "left(text, count)" },
  right: { min: 2, max: 2, fn: ([t, n]) => { const s = toText(t); const k = Math.max(0, toNum(n, "right")); return k ? s.slice(-k) : ""; }, help: "right(text, count)" },
  split: { min: 2, max: 2, fn: ([t, s]) => toText(t).split(toText(s)), help: "split(text, separator)" },
  join: { min: 1, max: 2, fn: ([l, s]) => toList(l, "join").map(toText).join(s === undefined ? ", " : toText(s)), help: "join(list, separator)" },
  text: { min: 1, max: 1, fn: ([v]) => toText(v), help: "text(value)" },
  // numbers
  number: { min: 1, max: 1, fn: ([v]) => toNum(v, "number"), help: "number(text)" },
  round: { min: 1, max: 2, fn: ([v, d]) => { const k = d === undefined ? 0 : Math.min(10, Math.max(0, toNum(d, "round"))); const f = 10 ** k; return Math.round(toNum(v, "round") * f) / f; }, help: "round(number, decimals)" },
  floor: { min: 1, max: 1, fn: ([v]) => Math.floor(toNum(v, "floor")), help: "floor(number)" },
  ceil: { min: 1, max: 1, fn: ([v]) => Math.ceil(toNum(v, "ceil")), help: "ceil(number)" },
  abs: { min: 1, max: 1, fn: ([v]) => Math.abs(toNum(v, "abs")), help: "abs(number)" },
  min: { min: 1, max: 50, fn: (a) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map((v) => toNum(v, "min"))), help: "min(a, b, …) or min(list)" },
  max: { min: 1, max: 50, fn: (a) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map((v) => toNum(v, "max"))), help: "max(a, b, …) or max(list)" },
  sum: { min: 1, max: 1, fn: ([l]) => toList(l, "sum").reduce<number>((s, v) => s + toNum(v, "sum"), 0), help: "sum(list)" },
  avg: { min: 1, max: 1, fn: ([l]) => { const x = toList(l, "avg"); return x.length ? x.reduce<number>((s, v) => s + toNum(v, "avg"), 0) / x.length : 0; }, help: "avg(list)" },
  // lists
  count: { min: 1, max: 1, fn: ([l]) => toList(l, "count").length, help: "count(list)" },
  first: { min: 1, max: 1, fn: ([l]) => toList(l, "first")[0] ?? null, help: "first(list)" },
  last: { min: 1, max: 1, fn: ([l]) => { const x = toList(l, "last"); return x[x.length - 1] ?? null; }, help: "last(list)" },
  pluck: { min: 2, max: 2, fn: ([l, k]) => toList(l, "pluck").map((x) => (x && typeof x === "object" && Object.hasOwn(x, toText(k)) && !FORBIDDEN.has(toText(k)) ? (x as Record<string, unknown>)[toText(k)] : null)), help: "pluck(list, field) — e.g. pluck(items, \"price\")" },
  // dates (UTC; ISO text in, ISO text out)
  now: { min: 0, max: 0, fn: () => new Date().toISOString(), help: "now()" },
  today: { min: 0, max: 0, fn: () => new Date().toISOString().slice(0, 10), help: "today() — YYYY-MM-DD (UTC)" },
  adddays: { min: 2, max: 2, fn: ([d, n]) => new Date(toDate(d, "addDays").getTime() + toNum(n, "addDays") * 86_400_000).toISOString(), help: "addDays(date, days)" },
  addhours: { min: 2, max: 2, fn: ([d, n]) => new Date(toDate(d, "addHours").getTime() + toNum(n, "addHours") * 3_600_000).toISOString(), help: "addHours(date, hours)" },
  datediff: {
    min: 2, max: 3,
    fn: ([a, b, u]) => {
      const ms = toDate(b, "dateDiff").getTime() - toDate(a, "dateDiff").getTime();
      const unit = toText(u ?? "days").toLowerCase();
      const div = unit.startsWith("min") ? 60_000 : unit.startsWith("hour") ? 3_600_000 : unit.startsWith("sec") ? 1000 : 86_400_000;
      return Math.floor(ms / div);
    },
    help: "dateDiff(start, end, \"days\"|\"hours\"|\"minutes\")",
  },
  formatdate: {
    min: 1, max: 2,
    fn: ([d, f]) => {
      const x = toDate(d, "formatDate");
      const map: Record<string, string> = { YYYY: String(x.getUTCFullYear()), MM: pad(x.getUTCMonth() + 1), DD: pad(x.getUTCDate()), HH: pad(x.getUTCHours()), mm: pad(x.getUTCMinutes()), ss: pad(x.getUTCSeconds()) };
      return toText(f ?? "YYYY-MM-DD").replace(/YYYY|MM|DD|HH|mm|ss/g, (k) => map[k]!);
    },
    help: "formatDate(date, \"YYYY-MM-DD HH:mm\") — UTC",
  },
};

export const FORMULA_FUNCTIONS = Object.entries(FUNCTIONS).map(([name, f]) => ({ name, help: f.help }));

function suggest(name: string) {
  const n = name.toLowerCase();
  const close = Object.keys(FUNCTIONS).filter((k) => k.startsWith(n.slice(0, 3)) || n.startsWith(k.slice(0, 3)));
  return close.length ? `Did you mean ${close.slice(0, 3).map((k) => FUNCTIONS[k]!.help.split("(")[0]).join(", ")}?` : "See the list of functions below the editor.";
}

/* ---------------- evaluation ---------------- */

function evaluate(n: Node, data: Record<string, unknown>, budget: { left: number }): unknown {
  if (--budget.left < 0) throw new FormulaError("The formula is too complex to evaluate.");
  switch (n.k) {
    case "lit":
      return n.v;
    case "path": {
      let cur: unknown = FORBIDDEN.has(n.root) ? undefined : Object.hasOwn(data, n.root) ? data[n.root] : undefined;
      for (const part of n.parts) {
        const key = typeof part === "string" ? part : evaluate(part, data, budget);
        if (cur === null || cur === undefined) return undefined;
        const k = typeof key === "number" ? key : toText(key);
        if (typeof k === "string" && FORBIDDEN.has(k)) return undefined;
        if (Array.isArray(cur)) cur = typeof k === "number" && Number.isInteger(k) ? cur[k < 0 ? cur.length + k : k] : undefined;
        else if (typeof cur === "object") cur = Object.hasOwn(cur as object, String(k)) ? (cur as Record<string, unknown>)[String(k)] : undefined;
        else return undefined;
      }
      return cur;
    }
    case "call": {
      const f = FUNCTIONS[n.name]!;
      if (n.args.length < f.min || n.args.length > f.max) throw new FormulaError(`${f.help.split(" ")[0]} takes ${f.min === f.max ? f.min : `${f.min}–${f.max}`} value${f.max === 1 ? "" : "s"}.`, n.p);
      // if() only evaluates the branch it returns.
      if (n.name === "if") return truthy(evaluate(n.args[0]!, data, budget)) ? evaluate(n.args[1]!, data, budget) : evaluate(n.args[2]!, data, budget);
      const r = f.fn(n.args.map((a) => evaluate(a, data, budget)));
      if (typeof r === "string" && r.length > MAX_STRING) throw new FormulaError("The result is too long.");
      if (typeof r === "number" && !Number.isFinite(r)) throw new FormulaError(`${f.help.split("(")[0]} gave an invalid number.`, n.p);
      return r;
    }
    case "un": {
      const a = evaluate(n.a, data, budget);
      return n.op === "!" ? !truthy(a) : -toNum(a, "-");
    }
    case "bin": {
      if (n.op === "&&") { const a = evaluate(n.a, data, budget); return truthy(a) ? evaluate(n.b, data, budget) : a; }
      if (n.op === "||") { const a = evaluate(n.a, data, budget); return truthy(a) ? a : evaluate(n.b, data, budget); }
      const a = evaluate(n.a, data, budget);
      const b = evaluate(n.b, data, budget);
      switch (n.op) {
        case "+":
          if (typeof a === "string" || typeof b === "string") {
            const s = toText(a) + toText(b);
            if (s.length > MAX_STRING) throw new FormulaError("The result is too long.");
            return s;
          }
          return toNum(a, "+") + toNum(b, "+");
        case "-": return toNum(a, "-") - toNum(b, "-");
        case "*": return toNum(a, "*") * toNum(b, "*");
        case "/": { const d = toNum(b, "/"); if (d === 0) throw new FormulaError("Division by zero.", n.p); return toNum(a, "/") / d; }
        case "%": { const d = toNum(b, "%"); if (d === 0) throw new FormulaError("Division by zero.", n.p); return toNum(a, "%") % d; }
        case "==": return looseEq(a, b);
        case "!=": return !looseEq(a, b);
        case "<": case "<=": case ">": case ">=": {
          const [x, y] = isNum(a) || isNum(b) ? [toNum(a, n.op), toNum(b, n.op)] : [toText(a), toText(b)];
          return n.op === "<" ? x < y : n.op === "<=" ? x <= y : n.op === ">" ? x > y : x >= y;
        }
      }
    }
  }
  throw new FormulaError("Unsupported expression.");
}

/** 5 == "5" is true (form fields arrive as text); null == undefined is true. */
function looseEq(a: unknown, b: unknown) {
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (isNum(a) && typeof b === "string" && b.trim() !== "") return a === Number(b);
  if (isNum(b) && typeof a === "string" && a.trim() !== "") return b === Number(a);
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Throws FormulaError with a helpful message if the formula can't be parsed. */
export function checkFormula(src: string): void {
  if (!src.trim()) throw new FormulaError("Enter a formula.");
  parse(src);
}

export function evalFormula(src: string, data: Record<string, unknown>): unknown {
  const r = evaluate(parse(src), data, { left: MAX_STEPS });
  return r === undefined ? null : r;
}
