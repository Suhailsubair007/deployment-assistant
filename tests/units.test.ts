import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCpu, formatMemory, parseCpuToMillicores, parseMemoryToBytes, percent } from "@/services/units.ts";

const cpuCases: [input: string, millicores: number][] = [
  ["250m", 250],
  ["1", 1000],
  ["0.5", 500],
  ["2", 2000],
  ["100000000n", 100], // the metrics API reports CPU in nanocores
  ["1500u", 1.5],
];
for (const [input, millicores] of cpuCases) {
  test(`CPU "${input}" is ${millicores} millicores`, () => {
    assert.equal(parseCpuToMillicores(input), millicores);
  });
}

const memoryCases: [input: string, bytes: number][] = [
  ["128974848", 128974848],
  ["512Ki", 524288],
  ["100Mi", 104857600],
  ["1Gi", 1073741824],
  ["1.5Gi", 1610612736],
  ["129M", 129000000],
  ["2G", 2000000000],
  ["129e6", 129000000],
  ["128974848000m", 128974848], // Kubernetes sometimes reports thousandths of a byte
];
for (const [input, bytes] of memoryCases) {
  test(`memory "${input}" is ${bytes} bytes`, () => {
    assert.equal(parseMemoryToBytes(input), bytes);
  });
}

test("a quantity that is not a number is rejected", () => {
  assert.throws(() => parseCpuToMillicores("abc"), new Error("Unrecognised quantity: abc"));
  assert.throws(() => parseMemoryToBytes("abc"), new Error("Unrecognised quantity: abc"));
});

test("a memory suffix is not accepted as a CPU value", () => {
  assert.throws(() => parseCpuToMillicores("512Mi"), new Error("Unrecognised quantity: 512Mi"));
});

const formatMemoryCases: [bytes: number, text: string][] = [
  [128974848, "123Mi"],
  [268435456, "256Mi"],
  [1073741824, "1Gi"],
  [1610612736, "1.5Gi"],
  [1073217536, "1Gi"], // 1023.5Mi rounds up to a whole Gi, never "1024Mi"
  [524288, "512Ki"],
  [512, "512B"],
];
for (const [bytes, text] of formatMemoryCases) {
  test(`${bytes} bytes is shown as ${text}`, () => {
    assert.equal(formatMemory(bytes), text);
  });
}

const formatCpuCases: [millicores: number, text: string][] = [
  [250, "250m"],
  [70.4, "70m"],
  [1000, "1 core"],
  [1500, "1.5 cores"],
  [2000, "2 cores"],
  [0.3, "<1m"], // a tiny amount must not look like zero
];
for (const [millicores, text] of formatCpuCases) {
  test(`${millicores} millicores is shown as ${text}`, () => {
    assert.equal(formatCpu(millicores), text);
  });
}

test("percent rounds to a whole number", () => {
  assert.equal(percent(127, 256), 50);
  assert.equal(percent(198, 256), 77);
});

test("percent is null when there is no total to compare against", () => {
  assert.equal(percent(5, 0), null);
});
