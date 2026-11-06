import { describe, expect, it } from "vitest";
import { checkFormula, evalFormula, FormulaError } from "./formula";

const data = { amount: 120, qty: "3", name: " ada ", tags: ["a", "b"], order: { items: [{ price: 10 }, { price: 15.5 }], customer: { email: "a@b.co" } }, empty: "", created: "2026-11-05T10:00:00Z" };
const ev = (s: string) => evalFormula(s, data);

describe("formula language", () => {
  it("does arithmetic with precedence and text joining", () => {
    expect(ev("amount * 1.08")).toBeCloseTo(129.6);
    expect(ev("1 + 2 * 3 - 4 / 2")).toBe(5);
    expect(ev("(1 + 2) * 3 % 4")).toBe(1);
    expect(ev("qty * 2")).toBe(6); // text numbers from forms work
    expect(ev("-amount + 20")).toBe(-100);
    expect(ev('"Total: " + amount')).toBe("Total: 120");
  });

  it("reads nested fields and list items", () => {
    expect(ev("order.items[1].price")).toBe(15.5);
    expect(ev("order.items[-1].price")).toBe(15.5);
    expect(ev('order["customer"].email')).toBe("a@b.co");
    expect(ev("order.missing.deep")).toBeNull();
    expect(ev("sum(pluck(order.items, \"price\"))")).toBe(25.5);
  });

  it("supports logic and functions", () => {
    expect(ev('if(amount > 100, "large", "small")')).toBe("large");
    expect(ev("amount >= 120 && contains(tags, \"b\")")).toBe(true);
    expect(ev("empty || \"fallback\"")).toBe("fallback");
    expect(ev("!isEmpty(empty)")).toBe(false);
    expect(ev("qty == 3")).toBe(true);
    expect(ev("concat(upper(trim(name)), \"!\")")).toBe("ADA!");
    expect(ev("round(avg(pluck(order.items, \"price\")), 1)")).toBe(12.8);
    expect(ev("join(split(\"a-b-c\", \"-\"), \"+\")")).toBe("a+b+c");
    expect(ev("replace(\"a.b.c\", \".\", \"/\")")).toBe("a/b/c");
    expect(ev("max(3, 9, 4)")).toBe(9);
    expect(ev("coalesce(missing, empty, \"x\")")).toBe("x");
  });

  it("handles dates in UTC", () => {
    expect(ev('formatDate(addDays(created, 7), "YYYY-MM-DD HH:mm")')).toBe("2026-11-12 10:00");
    expect(ev('dateDiff(created, "2026-11-08T10:00:00Z")')).toBe(3);
    expect(ev('dateDiff(created, addHours(created, 5), "hours")')).toBe(5);
  });

  it("only evaluates the chosen if() branch", () => {
    expect(ev("if(true, 1, 1 / 0)")).toBe(1);
  });

  it("gives clear errors", () => {
    expect(() => checkFormula("amount = 3")).toThrow(/Use ==/);
    expect(() => checkFormula('"open')).toThrow(/closing quote/);
    expect(() => checkFormula("uppr(name)")).toThrow(/Unknown function “uppr”.*upper/);
    expect(() => checkFormula("1 +")).toThrow(/ends too early/);
    expect(() => ev("round()")).toThrow(/takes 1–2 values/);
    expect(() => ev("amount / 0")).toThrow(/Division by zero/);
    expect(() => ev("sum(name)")).toThrow(/needs a list/);
    expect(() => checkFormula("")).toThrow(FormulaError);
  });

  it("cannot escape the sandbox", () => {
    expect(ev("constructor")).toBeNull();
    expect(ev("order.__proto__")).toBeNull();
    expect(ev("order.constructor.constructor")).toBeNull();
    expect(ev('order["__proto__"]')).toBeNull();
    expect(ev("tags.constructor")).toBeNull();
    expect(ev("toString")).toBeNull(); // inherited properties are invisible
    expect(() => checkFormula("process.exit()")).toThrow(); // calls only by whitelisted name
    expect(() => checkFormula("eval(\"1\")")).toThrow(/Unknown function/);
    expect(() => checkFormula("x".repeat(2001))).toThrow(/at most/);
    expect(() => checkFormula("(".repeat(60) + "1" + ")".repeat(60))).toThrow(/nested too deeply/);
    expect(ev(Array.from({ length: 300 }, () => "1").join(" + "))).toBe(300);
  });
});
