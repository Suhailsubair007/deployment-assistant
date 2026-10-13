import { GIBIBYTE, KIBIBYTE, MEMORY_SUFFIX_BYTES, MEBIBYTE, QUANTITY_PATTERN } from "@/constants/monitoring.ts";

/** Splits "512Ki" into 512 and "Ki". Throws when the text is not a quantity. */
function splitQuantity(quantity: string): { amount: number; suffix: string } {
  const match = QUANTITY_PATTERN.exec(quantity.trim());
  if (match === null) {
    throw new Error(`Unrecognised quantity: ${quantity}`);
  }
  return { amount: Number(match[1]), suffix: match[2] ?? "" };
}

/** CPU quantity to millicores (1000 millicores = one full CPU core). */
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
  const wholeMi = Math.round(bytes / MEBIBYTE);
  if (wholeMi >= 1024) {
    return `${oneDecimal(bytes / GIBIBYTE)}Gi`;
  }
  if (bytes >= MEBIBYTE) {
    return `${wholeMi}Mi`;
  }
  if (bytes >= KIBIBYTE) {
    return `${Math.round(bytes / KIBIBYTE)}Ki`;
  }
  return `${Math.round(bytes)}B`;
}

/** `used` as a whole-number percentage of `total`. */
export function percent(used: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  return Math.round((used / total) * 100);
}
