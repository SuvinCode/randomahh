import { describe, expect, it } from 'vitest';
import { parseCommand } from '../shared/parseCommand';
import { ghostFor, makeSuggester } from '../shared/suggest';
import { Trie } from '../shared/trie';

describe('Trie', () => {
  it('finds everything under a prefix, case-insensitively', () => {
    const t = new Trie<string>();
    ['tornado', 'tsunami', 'Tanda', 'volcano'].forEach((w) => t.insert(w, w));
    expect(t.withPrefix('t').sort()).toEqual(['Tanda', 'tornado', 'tsunami']);
    expect(t.withPrefix('TS')).toEqual(['tsunami']);
    expect(t.withPrefix('x')).toEqual([]);
    expect(t.withPrefix('').length).toBe(4);
    expect(t.size).toBe(4);
  });
});

describe('suggestions (predictive god box)', () => {
  const suggest = makeSuggester(['Bob', 'Bobby', 'Big Steve', 'Alice']);
  const top = (s: string) => suggest(s)[0]?.full;
  const all = (s: string) => suggest(s).map((x) => x.full);

  it('completes commands from a few letters', () => {
    expect(top('torn')).toBe('tornado');
    expect(top('volc')).toBe('volcano');
    expect(all('t')).toContain('tsunami');
    expect(top('bla')).toBe('black hole');
    expect(top('than')).toBe('thanos snap');
    expect(top('lava f')).toBe('lava floor');
    expect(top('god')).toBe('godzilla');
  });

  it('turns brand nicknames into their labels', () => {
    expect(top('clau')).toBe('Claude');
    expect(top('tand')).toBe('Tanda');
  });

  it('keeps counts and earlier clauses', () => {
    expect(top('3 tor')).toBe('3 tornado');
    expect(top('two vol')).toBe('two volcano');
    expect(top('tornado and vol')).toBe('tornado and volcano');
    expect(top('nuke, bla')).toBe('nuke, black hole');
  });

  it('predicts fighter names where a target goes', () => {
    expect(all('lightning on B')).toEqual(expect.arrayContaining(['lightning on Bob', 'lightning on Bobby', 'lightning on Big Steve']));
    expect(top('lightning on Ali')).toBe('lightning on Alice');
    expect(top('give Ali')).toBe('give Alice ');
    expect(top('heal Big')).toBe('heal Big Steve');
    expect(top('give ev')).toBe('give everyone ');
  });

  it('predicts what to give once the name is in', () => {
    expect(top('give Bob fl')).toBe('give Bob flight');
    expect(top('give Big Steve sh')).toBe('give Big Steve shield');
    expect(all('give everyone ro')).toContain('give everyone a rocket launcher');
    expect(all('give Alice ').length).toBeGreaterThan(3);
  });

  it('every prediction for a full command is something the parser understands', () => {
    for (const prefix of ['torn', 'clau', 'thanos', 'give Bob fl', 'lightning on Ali', '3 zom', 'nuk', 'disc', 'heal ev', 'give everyone ro']) {
      for (const s of suggest(prefix)) {
        if (s.full.endsWith(' ')) continue;
        expect(parseCommand(s.full, ['Bob', 'Bobby', 'Big Steve', 'Alice']), `${prefix} → ${s.full}`).not.toBeNull();
      }
    }
  });

  it('offers nothing for empty text or a finished word, and ghost text only extends what was typed', () => {
    expect(suggest('')).toEqual([]);
    expect(suggest('tornado').map((s) => s.full)).not.toContain('tornado');
    const s = suggest('torn');
    expect(ghostFor('torn', s)).toBe('ado');
    expect(ghostFor('xyz', s)).toBe('');
  });
});

describe('new commands', () => {
  const one = (t: string) => parseCommand(t, ['Bob'])!.actions[0];
  it('maps the brand logos, Thanos, disco, lava, Godzilla and the nuke', () => {
    expect(one('Claude')).toMatchObject({ type: 'logo_ram', label: 'Claude' });
    expect(one('ram the tanda logo at Bob')).toMatchObject({ type: 'logo_ram', label: 'Tanda', target: 'Bob' });
    expect(one('thanos').type).toBe('thanos_snap');
    expect(one('snap').type).toBe('thanos_snap');
    expect(one('disco').type).toBe('disco');
    expect(one('the floor is lava').type).toBe('lava_floor');
    expect(one('lava floor').type).toBe('lava_floor');
    expect(one('lava').type).toBe('volcano');
    expect(one('godzilla').type).toBe('godzilla');
    expect(one('nuke').type).toBe('nuke');
    expect(one('bomb').type).toBe('mega_bomb');
  });
});
