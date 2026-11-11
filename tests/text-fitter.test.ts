import test from "node:test";
import assert from "node:assert/strict";
import { TextFitter } from "../src/domain/TextFitter";

/** Ширина строки: полширины кегля на символ. Кегль берётся из строки шрифта, как это делает canvas. */
const sizeOf = (font: string) => Number(/(\d+)px/.exec(font)?.[1]);
const half = new TextFitter((font, text) => text.length * sizeOf(font) * 0.5);
const at = (size: number) => `700 ${size}px Display`;

test("text fit: a line that already fits keeps the starting size", () => {
  // 10 символов × 60 × 0,5 = 300
  assert.equal(half.fitSize("ЖИМ ЛЁЖА!!", 300, 60, 24, at), 60);
});

test("text fit: the size drops by two until the line fits", () => {
  // При 52 ширина 260 — это первый размер, не превышающий 260.
  assert.equal(half.fitSize("ЖИМ ЛЁЖА!!", 260, 60, 24, at), 52);
  assert.equal(half.fitSize("ЖИМ ЛЁЖА!!", 259, 60, 24, at), 50);
});

test("text fit: the minimum is a floor even when the step would skip over it", () => {
  // От 45 до 40 шаг 2 даёт 43, 41, 39: ниже минимума опускаться нельзя.
  assert.equal(half.fitSize("ЖИМ ЛЁЖА!!", 1, 45, 40, at), 40);
  // Строка не помещается и на минимуме — остаётся минимум.
  assert.equal(half.fitSize("ЖИМ ЛЁЖА!!", 1, 60, 24, at), 24);
});

test("text fit: the line is measured in the font of the size being tried", () => {
  const seen: string[] = [];
  const spy = new TextFitter((font, text) => {
    seen.push(font);
    return text.length * sizeOf(font) * 0.5;
  });
  spy.fitSize("ЖИМ ЛЁЖА!!", 250, 60, 24, at);
  assert.deepEqual(seen, [at(60), at(58), at(56), at(54), at(52), at(50)]);
});

test("ellipsis: a line that fits is returned as it was", () => {
  const fit = new TextFitter((_font, text) => text.length * 10);
  assert.equal(fit.ellipsize("Жим лёжа", 80, at(20)), "Жим лёжа");
});

test("ellipsis: the end is cut until the line with the ellipsis fits", () => {
  const fit = new TextFitter((_font, text) => text.length * 10);
  // «Присед со штангой» — 17 символов, место на 8: 7 букв и многоточие.
  const cut = fit.ellipsize("Присед со штангой", 80, at(20));
  assert.equal(cut, "Присед…");
  assert.ok(cut.length * 10 <= 80);
});

test("ellipsis: a space before the cut does not stay in front of the ellipsis", () => {
  const fit = new TextFitter((_font, text) => text.length * 10);
  assert.equal(fit.ellipsize("Жим лёжа широким", 50, at(20)), "Жим…");
});

test("ellipsis: at least one letter stays even when nothing fits", () => {
  const fit = new TextFitter((_font, text) => text.length * 100);
  assert.equal(fit.ellipsize("Жим", 10, at(20)), "Ж…");
});
