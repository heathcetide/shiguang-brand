import assert from "node:assert/strict";
import { test } from "node:test";
import { QuantityDecimal, QuantityPrecisionError, addQuantityValues, subtractQuantityValues } from "../src/quantityDecimal.ts";

test("decimal quantity arithmetic preserves JSON decimals and unit conversion", () => {
  assert.equal(addQuantityValues(0.1, 0.2), 0.3);
  assert.equal(subtractQuantityValues(0.3, 0.1), 0.2);
  assert.equal(QuantityDecimal.from(0.2).shift(-3).toNumber(), 0.0002);
  assert.equal(QuantityDecimal.from(5e-7).toString(), "0.0000005");
  assert.equal(QuantityDecimal.from(-0.1).toString(), "-0.1");
  for (const value of [0, -0, 1e6, 1e-20, Number.MIN_VALUE, Number.MAX_VALUE]) {
    assert.equal(QuantityDecimal.from(value).toNumber(), value === 0 ? 0 : value);
  }
  let value = 1;
  for (let index = 0; index < 10; index++) value = subtractQuantityValues(value, 0.1);
  assert.equal(value, 0);
});

test("unrepresentable results fail rather than round away an amount or remainder", () => {
  assert.throws(() => subtractQuantityValues(1, 1e-20), QuantityPrecisionError);
  assert.throws(() => QuantityDecimal.from(Number.MIN_VALUE).shift(-3).toNumber(), QuantityPrecisionError);
  assert.throws(() => QuantityDecimal.from(Number.MAX_VALUE).shift(3).toNumber(), QuantityPrecisionError);
  assert.throws(() => QuantityDecimal.from(Infinity), QuantityPrecisionError);
  assert.equal(QuantityDecimal.from(0.30000000000000004).compare(QuantityDecimal.from(0.3)), 1);
});

test("portion scaling multiplies and divides decimals before returning a number", () => {
  const scale = (amount: number, portions: number, yieldSize: number) =>
    QuantityDecimal.from(amount).multiply(QuantityDecimal.from(portions)).divide(QuantityDecimal.from(yieldSize)).toNumber();
  assert.equal(scale(0.1, 3, 1), 0.3);
  assert.equal(scale(0.1, 1.5, 2), 0.075);
  assert.equal(scale(0.6, 1, 3), 0.2);
  assert.equal(scale(0.3, 2, 3), 0.2);
  assert.equal(scale(0, 2, 3), 0);
  assert.equal(scale(-0.3, 2, -3), 0.2);
  assert.throws(() => scale(1, 1, 3), QuantityPrecisionError);
  assert.throws(() => scale(1, 1, 0), QuantityPrecisionError);
});
