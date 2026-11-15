// Python-compatible arithmetic.
//
// The placement is a greedy search over sorted candidates, so a one-ulp difference in a sort key or a
// distance test can pick a different position. These helpers reproduce what CPython 3.11 does where
// JavaScript differs: round() (exact, ties to even), float floor division, math.hypot / math.dist,
// math.radians / math.degrees, len() of a string, and truthiness of JSON values.
//
// Only +, -, *, / and sqrt are used here, which IEEE 754 defines exactly, so the results are also the
// same in every JavaScript engine (Math.hypot is "implementation-approximated" in the spec).

const view = new DataView(new ArrayBuffer(8));

/** 2 ** k for integer k, exact. */
function pow2(k: number): number {
  if (k > 1023) return Infinity;
  if (k < -1022) return pow2(k + 1022) * pow2(-1022);
  view.setUint32(0, (k + 1023) << 20);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

/** The exponent e of C frexp(x): x = m * 2**e with 0.5 <= |m| < 1. x must be finite and non-zero. */
function frexpExp(x: number): number {
  view.setFloat64(0, x);
  const biased = (view.getUint32(0) >>> 20) & 0x7ff;
  if (biased === 0) return frexpExp(x * pow2(64)) - 64; // subnormal
  return biased - 1022;
}

const T27 = 134217729.0; // 2**27 + 1, Veltkamp splitter

/** CPython 3.11 Modules/mathmodule.c vector_norm(), line by line. */
function vectorNorm(vec: number[], max: number): number {
  if (max === Infinity) return max;
  if (vec.some(Number.isNaN)) return NaN;
  if (max === 0 || vec.length <= 1) return max;
  const maxE = frexpExp(max);
  let csum = 1.0;
  let frac1 = 0.0;
  let frac2 = 0.0;
  let frac3 = 0.0;
  let x: number, t: number, hi: number, lo: number, oldcsum: number;
  if (maxE >= -1023) {
    const scale = pow2(-maxE);
    for (const v of vec) {
      x = v * scale;
      t = x * T27;
      hi = t - (t - x);
      lo = x - hi;
      x = hi * hi;
      oldcsum = csum;
      csum += x;
      frac1 += oldcsum - csum + x;
      x = 2.0 * hi * lo;
      oldcsum = csum;
      csum += x;
      frac2 += oldcsum - csum + x;
      frac3 += lo * lo;
    }
    const h = Math.sqrt(csum - 1.0 + (frac1 + frac2 + frac3));
    x = h;
    t = x * T27;
    hi = t - (t - x);
    lo = x - hi;
    x = -hi * hi;
    oldcsum = csum;
    csum += x;
    frac1 += oldcsum - csum + x;
    x = -2.0 * hi * lo;
    oldcsum = csum;
    csum += x;
    frac2 += oldcsum - csum + x;
    x = -lo * lo;
    oldcsum = csum;
    csum += x;
    frac3 += oldcsum - csum + x;
    x = csum - 1.0 + (frac1 + frac2 + frac3);
    return (h + x / (2.0 * h)) / scale;
  }
  for (const v of vec) {
    x = v / max;
    x = x * x;
    oldcsum = csum;
    csum += x;
    frac1 += oldcsum - csum + x;
  }
  return max * Math.sqrt(csum - 1.0 + frac1);
}

/** math.hypot(x, y) */
export function hypot(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  return vectorNorm([ax, ay], ax > ay ? ax : ay);
}

/** math.dist(p, q) for 2-D points */
export function dist(p: readonly [number, number], q: readonly [number, number]): number {
  return hypot(p[0] - q[0], p[1] - q[1]);
}

const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

/** math.radians: x * (pi / 180), not x * pi / 180. */
export function radians(deg: number): number {
  return deg * DEG_TO_RAD;
}

/** math.degrees */
export function degrees(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** Python float floor division a // b (Objects/floatobject.c _float_div_mod). */
export function floorDiv(a: number, b: number): number {
  const mod = a % b; // JS % is C fmod: exact, sign of the dividend
  let div = (a - mod) / b;
  if (mod) {
    if (b < 0 !== mod < 0) div -= 1.0;
  }
  if (div) {
    let fd = Math.floor(div);
    if (div - fd > 0.5) fd += 1.0;
    return fd;
  }
  return a / b < 0 || Object.is(a / b, -0) ? -0 : 0;
}

/** int(a // b) */
export function floorDivInt(a: number, b: number): number {
  return Math.trunc(floorDiv(a, b));
}

function roundHalfEvenInt(y: number): number {
  const f = Math.floor(y);
  const d = y - f; // exact
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Exact x * 10**n rounded half to even, for when the floating-point product is too close to a tie. */
function roundScaledExact(x: number, n: number): number {
  view.setFloat64(0, x);
  const hiWord = view.getUint32(0);
  const loWord = view.getUint32(4);
  const negative = hiWord >>> 31 === 1;
  const biased = (hiWord >>> 20) & 0x7ff;
  let mant = (BigInt(hiWord & 0xfffff) << 32n) | BigInt(loWord);
  let exp: number;
  if (biased === 0) {
    exp = -1074;
  } else {
    mant |= 1n << 52n;
    exp = biased - 1075;
  }
  // |x| = mant * 2**exp
  const num = mant * 10n ** BigInt(n);
  let k: bigint;
  if (exp >= 0) {
    k = num << BigInt(exp);
  } else {
    const den = 1n << BigInt(-exp);
    k = num / den;
    const r2 = (num - k * den) * 2n;
    if (r2 > den || (r2 === den && (k & 1n) === 1n)) k += 1n;
  }
  const kn = Number(k);
  return negative ? -kn : kn;
}

/** Python round(x) and round(x, n): the exact binary value rounded, ties to even. */
export function pyRound(x: number, ndigits?: number): number {
  if (!Number.isFinite(x)) return x;
  if (ndigits === undefined || ndigits === 0) return roundHalfEvenInt(x);
  if (ndigits > 22 || ndigits < 0) throw new RangeError("pyRound: ndigits must be 0..22");
  const p = 10 ** ndigits; // exact for n <= 22
  const y = x * p;
  if (!Number.isFinite(y)) return x;
  const f = Math.floor(y);
  const d = y - f;
  // y differs from the exact product by at most half an ulp; outside that band the direction is certain.
  const band = Math.max(1, Math.abs(y)) * 2 ** -50;
  let k: number;
  if (Math.abs(d - 0.5) > band) {
    k = d < 0.5 ? f : f + 1;
  } else {
    k = roundScaledExact(x, ndigits);
  }
  const r = k / p;
  return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r;
}

/** len(s) in Python counts code points; String#length counts UTF-16 units. */
export function pyLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Python truthiness of a JSON value ([] and {} are false in Python, true in JavaScript). */
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v !== null && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

/** str(v) for a JSON value. JSON.parse loses the 3 / 3.0 distinction, so whole floats print as ints. */
export function pyStr(v: unknown): string {
  if (v === true) return "True";
  if (v === false) return "False";
  if (v === null || v === undefined) return "None";
  return String(v);
}

/** |x| = n / 10**k exactly (every finite double is a finite decimal). */
function exactDecimal(x: number): { neg: boolean; n: bigint; k: number } {
  view.setFloat64(0, x);
  const hiWord = view.getUint32(0);
  const neg = hiWord >>> 31 === 1;
  const biased = (hiWord >>> 20) & 0x7ff;
  let mant = (BigInt(hiWord & 0xfffff) << 32n) | BigInt(view.getUint32(4));
  let e: number;
  if (biased === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = biased - 1075;
  }
  if (e >= 0) return { neg, n: mant << BigInt(e), k: 0 };
  return { neg, n: mant * 5n ** BigInt(-e), k: -e };
}

/** n / 10**drop rounded half to even. */
function divRoundEven(n: bigint, drop: number): bigint {
  if (drop <= 0) return n * 10n ** BigInt(-drop);
  const d = 10n ** BigInt(drop);
  const q = n / d;
  const r2 = (n - q * d) * 2n;
  return r2 > d || (r2 === d && (q & 1n) === 1n) ? q + 1n : q;
}

/** Python format(x, ".{digits}f") */
export function formatF(x: number, digits: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const { neg, n, k } = exactDecimal(x);
  const s = divRoundEven(n, k - digits).toString().padStart(digits + 1, "0");
  const body = digits > 0 ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
  return (neg ? "-" : "") + body;
}

/** Python format(x, "g"): 6 significant digits, trailing zeros removed. */
export function formatG(x: number, precision = 6): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const { neg, n, k } = exactDecimal(x);
  const sign = neg ? "-" : "";
  if (n === 0n) return `${sign}0`;
  const len = n.toString().length;
  let exp = len - 1 - k;
  let m = divRoundEven(n, len - precision);
  if (m.toString().length > precision) {
    m /= 10n;
    exp += 1;
  }
  const d = m.toString();
  const strip = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (exp >= -4 && exp < precision) {
    const fixed = exp >= 0 ? `${d.slice(0, exp + 1)}.${d.slice(exp + 1)}` : `0.${"0".repeat(-exp - 1)}${d}`;
    return sign + strip(fixed);
  }
  const mant = strip(`${d[0]}.${d.slice(1)}`);
  return `${sign}${mant}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
}

/** str(x) of a Python float: shortest round-trip digits, always with a decimal point or exponent. */
export function floatRepr(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-4 || a >= 1e16)) {
    const [m, e] = x.toExponential().split("e") as [string, string];
    const ee = Number(e);
    return `${m}e${ee < 0 ? "-" : "+"}${String(Math.abs(ee)).padStart(2, "0")}`;
  }
  const s = Object.is(x, -0) ? "-0" : String(x);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** Python html.escape(s, quote=True) */
export function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}
