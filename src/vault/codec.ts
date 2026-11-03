import { concat } from '@/crypto/bytes';

/**
 * Turns a database row into bytes and back. JSON, plus the three things JSON cannot carry and the apps store: dates,
 * binary data and Blobs (voice recordings). Blob contents follow the JSON in the same buffer, so a row is one piece
 * that can be sealed with one tag.
 *
 *   [4 bytes: JSON length][JSON][blob 0][blob 1]…     ("$blob" entries say index, size and type)
 */

const TAG = '$t';

interface Pending {
  bytes: Uint8Array;
}

async function walk(value: unknown, blobs: Pending[]): Promise<unknown> {
  if (value instanceof Date) return { [TAG]: 'date', v: value.getTime() };
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    blobs.push({ bytes });
    return { [TAG]: 'blob', i: blobs.length - 1, n: bytes.length, type: value.type };
  }
  if (value instanceof ArrayBuffer) return walk(new Uint8Array(value), blobs);
  if (ArrayBuffer.isView(value)) {
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    blobs.push({ bytes: view });
    return { [TAG]: 'bytes', i: blobs.length - 1, n: view.length };
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => walk(item, blobs)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      // a real key that starts with a dollar sign is escaped, so data can never pass for one of our tags
      out[key.startsWith('$') ? '$' + key : key] = await walk(item, blobs);
    }
    return out;
  }
  return value;
}

export async function encodeRow(row: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const blobs: Pending[] = [];
  const json = new TextEncoder().encode(JSON.stringify(await walk(row, blobs)));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, json.length);
  return concat(head, json, ...blobs.map(b => b.bytes));
}

export function decodeRow(bytes: Uint8Array): unknown {
  const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const json = new TextDecoder().decode(bytes.subarray(4, 4 + jsonLength));
  const base = 4 + jsonLength;
  // offsets of the blob parts follow from their sizes, in order of index
  const sizes = new Map<number, number>();
  const find = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(find);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ((o[TAG] === 'blob' || o[TAG] === 'bytes') && typeof o.i === 'number') sizes.set(o.i, o.n as number);
      else Object.values(o).forEach(find);
    }
  };
  const parsed: unknown = JSON.parse(json);
  find(parsed);
  const offsets: number[] = [];
  let at = base;
  for (let i = 0; i < sizes.size; i++) {
    offsets[i] = at;
    at += sizes.get(i) ?? 0;
  }
  const revive = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o[TAG] === 'date') return new Date(o.v as number);
      if (o[TAG] === 'blob') return new Blob([bytes.slice(offsets[o.i as number], offsets[o.i as number]! + (o.n as number))], { type: o.type as string });
      if (o[TAG] === 'bytes') return bytes.slice(offsets[o.i as number], offsets[o.i as number]! + (o.n as number));
      return Object.fromEntries(Object.entries(o).map(([k, item]) => [k.startsWith('$$') ? k.slice(1) : k, revive(item)]));
    }
    return v;
  };
  return revive(parsed);
}
