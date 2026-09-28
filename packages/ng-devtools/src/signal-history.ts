import type { SignalChange, SignalGraphNode } from './types.ts';

export const MAX_CHANGES = 50;
const MAX_TRACKS = 500;
export const MAX_NODES = 500;
const VALUE_KINDS = new Set(['signal', 'computed', 'linkedSignal']);

/** The fields Angular's `setPostSignalSetFn` hook exposes on a signal node. */
export interface RawSignalNode {
  debugName?: string;
  kind?: string;
  value?: unknown;
  version?: number;
}

interface Track {
  ref: WeakRef<RawSignalNode>;
  label: string;
  kind: string;
  changes: SignalChange[];
}

function append(list: SignalChange[], change: SignalChange) {
  list.push(change);
  if (list.length > MAX_CHANGES) list.splice(0, list.length - MAX_CHANGES);
}

export function createSignalHistory(
  serialize: (value: unknown, name?: string) => unknown,
  now = Date.now,
) {
  const tracks = new Map<string, Track>();
  const trackIds = new WeakMap<RawSignalNode, string>();
  const bound = new Map<string, string>();
  const history = new Map<string, SignalChange[]>();
  const sent = new Map<string, number>();
  let trackSeq = 0;

  function onWrite(node: RawSignalNode) {
    // Unnamed writes can't be matched to a graph node; snapshots still cover them.
    if (!node.debugName) return;
    const id = trackIds.get(node);
    let track = id ? tracks.get(id) : undefined;
    if (!track) {
      const newId = `w${++trackSeq}`;
      track = {
        ref: new WeakRef(node),
        label: node.debugName,
        kind: node.kind ?? 'signal',
        changes: [],
      };
      trackIds.set(node, newId);
      tracks.set(newId, track);
      if (tracks.size > MAX_TRACKS) tracks.delete(tracks.keys().next().value!);
    }
    append(track.changes, {
      epoch: node.version ?? 0,
      value: serialize(node.value, node.debugName),
      at: now(),
      source: 'write',
    });
  }

  function findTrack(node: SignalGraphNode, taken: Set<string>): Track | undefined {
    const boundId = bound.get(node.id);
    if (boundId && tracks.has(boundId)) return tracks.get(boundId);
    bound.delete(node.id);
    if (!node.label) return undefined;
    const matches: string[] = [];
    for (const [id, track] of tracks) {
      const raw = track.ref.deref();
      if (!raw) {
        tracks.delete(id);
        continue;
      }
      if (
        !taken.has(id) &&
        track.label === node.label &&
        track.kind === node.kind &&
        raw.version === node.epoch
      ) {
        matches.push(id);
      }
    }
    // Two live signals with the same name and version are ambiguous; retry next snapshot.
    if (matches.length !== 1) return undefined;
    bound.set(node.id, matches[0]);
    taken.add(matches[0]);
    return tracks.get(matches[0]);
  }

  function collect(nodes: SignalGraphNode[]): Record<string, SignalChange[]> {
    const taken = new Set(bound.values());
    const out: Record<string, SignalChange[]> = {};
    for (const node of nodes) {
      if (!VALUE_KINDS.has(node.kind)) continue;
      const list = history.get(node.id) ?? [];
      let lastEpoch = list.at(-1)?.epoch ?? -1;
      for (const change of findTrack(node, taken)?.changes ?? []) {
        if (change.epoch <= lastEpoch) continue;
        append(list, change);
        lastEpoch = change.epoch;
      }
      if (node.epoch > lastEpoch) {
        const missed = lastEpoch >= 0 ? node.epoch - lastEpoch - 1 : 0;
        append(list, {
          epoch: node.epoch,
          value: node.value,
          at: now(),
          source: lastEpoch < 0 ? 'initial' : 'sample',
          ...(missed > 0 ? { missed } : {}),
        });
      }
      history.delete(node.id);
      history.set(node.id, list);
      out[node.id] = list.slice();
    }
    for (const id of history.keys()) {
      if (history.size <= MAX_NODES) break;
      history.delete(id);
      bound.delete(id);
    }
    return out;
  }

  function collectDelta(nodes: SignalGraphNode[], full = false): Record<string, SignalChange[]> {
    const out: Record<string, SignalChange[]> = {};
    for (const [id, list] of Object.entries(collect(nodes))) {
      const last = full ? -Infinity : (sent.get(id) ?? -Infinity);
      const fresh = list.filter((change) => change.epoch > last);
      if (list.length) {
        sent.delete(id);
        sent.set(id, list.at(-1)!.epoch);
      }
      if (fresh.length) out[id] = fresh;
    }
    for (const id of sent.keys()) {
      if (sent.size <= MAX_NODES) break;
      sent.delete(id);
    }
    return out;
  }

  return { onWrite, collect, collectDelta };
}
