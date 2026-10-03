export interface Uf2Summary {
  blockCount: number;
  addressStart: number;
  addressEnd: number;
  familyId: number;
}

export type Uf2Platform = 'rp2040' | 'rp2350-arm-s';

const blockSize = 512;
const magicStart0 = 0x0a324655;
const magicStart1 = 0x9e5d5157;
const magicEnd = 0x0ab16f30;
const familyIdFlag = 0x00002000;
const extensionTagsFlag = 0x00008000;
const flashStart = 0x10000000;
const maxPayloadSize = 476;

// picotool prepends this block to RP2350 images so the bootrom ignores stale RP2350-E10 data.
const absoluteFamilyId = 0xe48bff57;
const absoluteBlockAddress = 0x10ffff00;
const absoluteBlockPayloadSize = 256;
const absoluteBlockFill = 0xef;
const absoluteBlockExtensionTag = 0x9957e304;

interface PlatformRules {
  chip: string;
  familyId: number;
  flashEnd: number;
  flashDescription: string;
}

const platformRules: Record<Uf2Platform, PlatformRules> = {
  rp2040: { chip: 'RP2040', familyId: 0xe48bff56, flashEnd: 0x10200000, flashDescription: 'RP2040 Pico flash range' },
  'rp2350-arm-s': { chip: 'RP2350', familyId: 0xe48bff59, flashEnd: 0x11000000, flashDescription: 'RP2350 flash range' },
};

interface FlashRange {
  start: number;
  end: number;
}

export function validateUf2(data: Uint8Array, platform: Uf2Platform = 'rp2040'): Uf2Summary {
  if (data.byteLength === 0 || data.byteLength % blockSize !== 0) {
    throw new Error('UF2 must contain complete 512-byte blocks.');
  }
  const rules = platformRules[platform];
  const totalBlocks = data.byteLength / blockSize;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let index = 0; index < totalBlocks; index++) {
    const offset = index * blockSize;
    if (view.getUint32(offset, true) !== magicStart0 ||
        view.getUint32(offset + 4, true) !== magicStart1 ||
        view.getUint32(offset + 508, true) !== magicEnd) {
      throw new Error(`UF2 block ${index} has invalid magic values.`);
    }
  }

  let firstImageBlock = 0;
  if (platform === 'rp2350-arm-s' && view.getUint32(28, true) === absoluteFamilyId) {
    validateAbsoluteBlock(data, view);
    firstImageBlock = 1;
  }

  if (platform === 'rp2350-arm-s') {
    for (let index = firstImageBlock; index < totalBlocks; index++) {
      if (view.getUint32(index * blockSize + 28, true) === absoluteFamilyId) {
        throw new Error(`UF2 block ${index} is an absolute block that is not the first block.`);
      }
    }
  }

  const blockCount = totalBlocks - firstImageBlock;
  if (blockCount === 0) throw new Error('UF2 does not contain any image blocks.');
  const seenBlocks = new Set<number>();
  const ranges: FlashRange[] = [];

  for (let index = firstImageBlock; index < totalBlocks; index++) {
    const offset = index * blockSize;
    const blockFlags = view.getUint32(offset + 8, true);
    const address = view.getUint32(offset + 12, true);
    const payloadSize = view.getUint32(offset + 16, true);
    const blockNumber = view.getUint32(offset + 20, true);
    const declaredCount = view.getUint32(offset + 24, true);
    const blockFamilyId = view.getUint32(offset + 28, true);

    if (blockFlags !== familyIdFlag) throw new Error(`UF2 block ${index} has unsupported flags.`);
    if (blockFamilyId !== rules.familyId) throw new Error(`UF2 block ${index} is not for the ${rules.chip} family.`);

    if (declaredCount !== blockCount) throw new Error(`UF2 block ${index} declares an inconsistent block count.`);
    if (blockNumber >= blockCount || seenBlocks.has(blockNumber)) throw new Error('UF2 block numbers must be unique and cover the declared block count.');
    seenBlocks.add(blockNumber);

    if (payloadSize === 0 || payloadSize > maxPayloadSize || payloadSize % 4 !== 0) {
      throw new Error(`UF2 block ${index} has an invalid payload size.`);
    }
    if (address % 4 !== 0) throw new Error(`UF2 block ${index} has a target address that is not aligned.`);
    const end = address + payloadSize;
    if (address < flashStart || end > rules.flashEnd) throw new Error(`UF2 block ${index} is outside the ${rules.flashDescription}.`);
    ranges.push({ start: address, end });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index]!.start < ranges[index - 1]!.end) throw new Error('UF2 payload address ranges overlap.');
  }
  if (ranges[0]!.start !== flashStart) throw new Error(`UF2 does not include the ${rules.chip} bootable flash region.`);

  return {
    blockCount,
    addressStart: ranges[0]!.start,
    addressEnd: ranges.at(-1)!.end,
    familyId: rules.familyId,
  };
}

function validateAbsoluteBlock(data: Uint8Array, view: DataView): void {
  const flags = view.getUint32(8, true);
  if (flags !== familyIdFlag && flags !== (familyIdFlag | extensionTagsFlag)) {
    throw new Error('UF2 absolute block has unsupported flags.');
  }
  if (view.getUint32(12, true) !== absoluteBlockAddress || view.getUint32(16, true) !== absoluteBlockPayloadSize) {
    throw new Error('UF2 absolute block has an unexpected target address or payload size.');
  }
  for (let offset = 32; offset < 32 + absoluteBlockPayloadSize; offset++) {
    if (data[offset] !== absoluteBlockFill) throw new Error('UF2 absolute block payload is not the expected erase pattern.');
  }
  if ((flags & extensionTagsFlag) !== 0 && view.getUint32(32 + absoluteBlockPayloadSize, true) !== absoluteBlockExtensionTag) {
    throw new Error('UF2 absolute block has an unexpected extension tag.');
  }
}