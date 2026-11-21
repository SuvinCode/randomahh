/**
 * A prefix tree (trie): insert phrases once, then find everything that starts
 * with what the host has typed so far in time proportional to the prefix.
 * Keys are matched case-insensitively; items keep their own casing.
 */
interface TrieNode<T> {
  children: Map<string, TrieNode<T>>;
  items: T[];
}

export class Trie<T> {
  private readonly root: TrieNode<T> = { children: new Map(), items: [] };
  private count = 0;

  get size(): number {
    return this.count;
  }

  insert(key: string, item: T): void {
    let node = this.root;
    for (const ch of key.toLowerCase()) {
      let next = node.children.get(ch);
      if (!next) {
        next = { children: new Map(), items: [] };
        node.children.set(ch, next);
      }
      node = next;
    }
    node.items.push(item);
    this.count++;
  }

  /** Every item whose key starts with `prefix` (all items for ""). */
  withPrefix(prefix: string): T[] {
    let node: TrieNode<T> | undefined = this.root;
    for (const ch of prefix.toLowerCase()) {
      node = node.children.get(ch);
      if (!node) return [];
    }
    const out: T[] = [];
    const stack: TrieNode<T>[] = [node];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(...n.items);
      for (const child of n.children.values()) stack.push(child);
    }
    return out;
  }
}
