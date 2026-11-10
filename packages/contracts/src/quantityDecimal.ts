/**
 * Use each finite number's shortest decimal spelling, including scientific
 * notation. Arithmetic stays decimal until a number must cross an API/DB boundary.
 * No schema rounding, fixed precision floor, or floating-point tolerance is used.
 */
export class QuantityPrecisionError extends Error {
  constructor() {
    super("扣减量超出当前库存可保存的计量精度，请调整数量单位后重试");
    this.name = "QuantityPrecisionError";
  }
}

export class QuantityDecimal {
  private readonly coefficient: bigint;
  private readonly exponent: number;

  private constructor(coefficient: bigint, exponent: number) {
    this.coefficient = coefficient;
    this.exponent = exponent;
  }

  private static normalized(coefficient: bigint, exponent: number): QuantityDecimal {
    if (coefficient === 0n) return new QuantityDecimal(0n, 0);
    while (coefficient % 10n === 0n) { coefficient /= 10n; exponent++; }
    return new QuantityDecimal(coefficient, exponent);
  }

  static from(value: number): QuantityDecimal {
    if (!Number.isFinite(value)) throw new QuantityPrecisionError();
    const [mantissa, exponent = "0"] = value.toString().split("e");
    const [integer, fraction = ""] = mantissa.split(".");
    return QuantityDecimal.normalized(BigInt(integer + fraction), Number(exponent) - fraction.length);
  }

  add(other: QuantityDecimal): QuantityDecimal {
    const exponent = Math.min(this.exponent, other.exponent);
    return QuantityDecimal.normalized(
      this.coefficient * 10n ** BigInt(this.exponent - exponent)
        + other.coefficient * 10n ** BigInt(other.exponent - exponent), exponent,
    );
  }

  subtract(other: QuantityDecimal): QuantityDecimal {
    return this.add(new QuantityDecimal(-other.coefficient, other.exponent));
  }

  multiply(other: QuantityDecimal): QuantityDecimal {
    return QuantityDecimal.normalized(this.coefficient * other.coefficient, this.exponent + other.exponent);
  }

  /** Only terminating decimal quotients can become an exact ingredient demand. */
  divide(other: QuantityDecimal): QuantityDecimal {
    if (other.coefficient === 0n) throw new QuantityPrecisionError();
    let numerator = this.coefficient;
    let denominator = other.coefficient;
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    let left = numerator < 0n ? -numerator : numerator;
    let right = denominator;
    while (right !== 0n) { const remainder = left % right; left = right; right = remainder; }
    numerator /= left;
    denominator /= left;
    let twos = 0;
    let fives = 0;
    while (denominator % 2n === 0n) { denominator /= 2n; twos++; }
    while (denominator % 5n === 0n) { denominator /= 5n; fives++; }
    if (denominator !== 1n) throw new QuantityPrecisionError();
    const scale = Math.max(twos, fives);
    return QuantityDecimal.normalized(
      numerator * 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives),
      this.exponent - other.exponent - scale,
    );
  }

  compare(other: QuantityDecimal): number {
    const difference = this.subtract(other).coefficient;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  /** Inventory unit conversions are powers of ten, never a guessed density. */
  shift(exponent: -3 | 0 | 3): QuantityDecimal {
    return QuantityDecimal.normalized(this.coefficient, this.exponent + exponent);
  }

  toNumber(): number {
    const result = Number(this.coefficient.toString() + "e" + this.exponent);
    if (!Number.isFinite(result) || QuantityDecimal.from(result).compare(this) !== 0) {
      throw new QuantityPrecisionError();
    }
    return result;
  }

  /** Plain decimal text keeps tiny, known quantities readable and parseable. */
  toString(): string {
    const negative = this.coefficient < 0n;
    const digits = (negative ? -this.coefficient : this.coefficient).toString();
    const point = digits.length + this.exponent;
    const result = point <= 0 ? "0." + "0".repeat(-point) + digits
      : point >= digits.length ? digits + "0".repeat(point - digits.length)
        : digits.slice(0, point) + "." + digits.slice(point);
    return (negative ? "-" : "") + result;
  }
}

export const addQuantityValues = (left: number, right: number) =>
  QuantityDecimal.from(left).add(QuantityDecimal.from(right)).toNumber();
export const subtractQuantityValues = (left: number, right: number) =>
  QuantityDecimal.from(left).subtract(QuantityDecimal.from(right)).toNumber();
