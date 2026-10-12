// Kubernetes writes CPU and memory as "quantities": a number with an optional suffix,
// for example "250m" (CPU) or "512Ki" (memory). These helpers turn them into plain
// numbers for calculations and back into text a person can read.

const KI = 1024;
const MI = 1024 * KI;
const GI = 1024 * MI;
const TI = 1024 * GI;

// A number such as "250", "0.5" or "129e6", followed by an optional suffix.
const QUANTITY = /^(\d+(?:\.\d+)?(?:[eE]\d+)?)([a-zA-Z]*)$/;

/** Splits "512Ki" into 512 and "Ki". Throws when the text is not a quantity. */
function splitQuantity(quantity: string): { amount: number; suffix: string } {
  const match = QUANTITY.exec(quantity.trim());
  if (match === null) {
    throw new Error(`Unrecognised quantity: ${quantity}`);
  }
  return { amount: Number(match[1]), suffix: match[2] ?? "" };
}

/**
 * CPU quantity to millicores (1000 millicores = one full CPU core).
 * "250m" -> 250, "1" -> 1000, "100000000n" -> 100.
 */
export function parseCpuToMillicores(quantity: string): number {
  const { amount, suffix } = splitQuantity(quantity);
  switch (suffix) {
    case "":
      return amount * 1000; // whole cores
    case "m":
      return amount; // millicores
    case "u":
      return amount / 1000; // microcores
    case "n":
      return amount / 1_000_000; // nanocores, used by the metrics API
    default:
      throw new Error(`Unrecognised quantity: ${quantity}`);
  }
}

// How many bytes one unit of each memory suffix is worth.
// "Ki", "Mi", "Gi" count in steps of 1024; "k", "M", "G" count in steps of 1000.
const MEMORY_SUFFIX_BYTES: Record<string, number> = {
  "": 1,
  m: 1 / 1000,
  k: 1000,
  M: 1000 ** 2,
  G: 1000 ** 3,
  T: 1000 ** 4,
  Ki: KI,
  Mi: MI,
  Gi: GI,
  Ti: TI,
};

/** Memory quantity to bytes. "512Ki" -> 524288, "1Gi" -> 1073741824, "128974848" -> 128974848. */
export function parseMemoryToBytes(quantity: string): number {
  const { amount, suffix } = splitQuantity(quantity);
  const bytesPerUnit = MEMORY_SUFFIX_BYTES[suffix];
  if (bytesPerUnit === undefined) {
    throw new Error(`Unrecognised quantity: ${quantity}`);
  }
  return Math.round(amount * bytesPerUnit);
}

/** "1.0" -> "1", "1.5" -> "1.5". */
function oneDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** Millicores as text: 250 -> "250m", 1500 -> "1.5 cores". */
export function formatCpu(millicores: number): string {
  if (millicores > 0 && millicores < 1) {
    return "<1m";
  }
  const rounded = Math.round(millicores);
  if (rounded < 1000) {
    return `${rounded}m`;
  }
  const cores = oneDecimal(millicores / 1000);
  return cores === "1" ? "1 core" : `${cores} cores`;
}

/** Bytes as text: 128974848 -> "123Mi", 1610612736 -> "1.5Gi". */
export function formatMemory(bytes: number): string {
  const wholeMi = Math.round(bytes / MI);
  if (wholeMi >= 1024) {
    return `${oneDecimal(bytes / GI)}Gi`;
  }
  if (bytes >= MI) {
    return `${wholeMi}Mi`;
  }
  if (bytes >= KI) {
    return `${Math.round(bytes / KI)}Ki`;
  }
  return `${Math.round(bytes)}B`;
}

/**
 * `used` as a whole-number percentage of `total`.
 * Returns null when there is no total (for example a container without a limit),
 * so callers never show a made-up number.
 */
export function percent(used: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  return Math.round((used / total) * 100);
}
