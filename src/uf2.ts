export interface Uf2Summary {
  blockCount: number;
  addressStart: number;
  addressEnd: number;
  familyId: number;
}

const blockSize = 512;
const magicStart0 = 0x0a324655;
const magicStart1 = 0x9e5d5157;
const magicEnd = 0x0ab16f30;
const familyIdFlag = 0x00002000;
const rp2040FamilyId = 0xe48bff56;
const picoFlashStart = 0x10000000;
const picoFlashEnd = 0x10200000;
const maxPayloadSize = 476;

interface FlashRange {
  start: number;
  end: number;
}

export function validateUf2(data: Uint8Array): Uf2Summary {
  if (data.byteLength === 0 || data.byteLength % blockSize !== 0) {
    throw new Error('UF2 must contain complete 512-byte blocks.');
  }
  const blockCount = data.byteLength / blockSize;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const seenBlocks = new Set<number>();
  const ranges: FlashRange[] = [];
  let familyId: number | undefined;
  let flags: number | undefined;

  for (let index = 0; index < blockCount; index++) {
    const offset = index * blockSize;
    if (view.getUint32(offset, true) !== magicStart0 ||
        view.getUint32(offset + 4, true) !== magicStart1 ||
        view.getUint32(offset + 508, true) !== magicEnd) {
      throw new Error(`UF2 block ${index} has invalid magic values.`);
    }

    const blockFlags = view.getUint32(offset + 8, true);
    if (blockFlags !== familyIdFlag) throw new Error(`UF2 block ${index} has unsupported flags.`);
    if (flags !== undefined && blockFlags !== flags) throw new Error('UF2 blocks have inconsistent flags.');
    flags = blockFlags;

    const address = view.getUint32(offset + 12, true);
    const payloadSize = view.getUint32(offset + 16, true);
    const blockNumber = view.getUint32(offset + 20, true);
    const declaredCount = view.getUint32(offset + 24, true);
    const blockFamilyId = view.getUint32(offset + 28, true);
    if (blockFamilyId !== rp2040FamilyId) throw new Error(`UF2 block ${index} is not for the RP2040 family.`);
    if (familyId !== undefined && blockFamilyId !== familyId) throw new Error('UF2 blocks have inconsistent family IDs.');
    familyId = blockFamilyId;

    if (declaredCount !== blockCount) throw new Error(`UF2 block ${index} declares an inconsistent block count.`);
    if (blockNumber >= blockCount || seenBlocks.has(blockNumber)) throw new Error('UF2 block numbers must be unique and cover the declared block count.');
    seenBlocks.add(blockNumber);

    if (payloadSize === 0 || payloadSize > maxPayloadSize || payloadSize % 4 !== 0) {
      throw new Error(`UF2 block ${index} has an invalid payload size.`);
    }
    if (address % 4 !== 0) throw new Error(`UF2 block ${index} has a target address that is not aligned.`);
    const end = address + payloadSize;
    if (address < picoFlashStart || end > picoFlashEnd) throw new Error(`UF2 block ${index} is outside the RP2040 Pico flash range.`);
    ranges.push({ start: address, end });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index]!.start < ranges[index - 1]!.end) throw new Error('UF2 payload address ranges overlap.');
  }
  if (ranges[0]!.start !== picoFlashStart) throw new Error('UF2 does not include the RP2040 Pico bootable flash region.');

  return {
    blockCount,
    addressStart: ranges[0]!.start,
    addressEnd: ranges.at(-1)!.end,
    familyId: familyId!,
  };
}