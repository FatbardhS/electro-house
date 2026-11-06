import { describe, expect, it } from 'vitest';
import { translateText } from './translate.js';

describe('translateText', () => {
  it('leaves English and unknown text unchanged', () => {
    expect(translateText('Double outlet', 'en')).toBe('Double outlet');
    expect(translateText('Familja Berisha', 'sq')).toBe('Familja Berisha');
  });

  it('translates exact texts', () => {
    expect(translateText('Double outlet', 'sq')).toBe('Prizë e dyfishtë');
  });

  it('fills templates and translates the values inside', () => {
    expect(translateText('S1 (Double outlet) has no wire connected.', 'sq')).toBe('S1 (Prizë e dyfishtë) nuk ka asnjë kabllo të lidhur.');
    expect(translateText('Circuit 2 Living room sockets: 16 A breaker exceeds your 13 A limit for 2.5 mm².', 'sq')).toBe(
      'Qarku 2 Living room sockets: siguresa 16 A tejkalon kufirin tuaj 13 A për 2,5 mm².',
    );
    expect(translateText('Board MDB: phases are unbalanced (L1 0.1, L2 3.0, L3 0.0 kW).', 'sq')).toBe(
      'Paneli MDB: fazat janë të pabalancuara (L1 0,1, L2 3,0, L3 0,0 kW).',
    );
  });

  it('translates lists inside templates', () => {
    expect(translateText('A wire: 1.5 mm² is smaller than the circuit’s 2.5 mm²; cable type NYY-J differs from the circuit’s NYM-J.', 'sq')).toBe(
      'Një kabllo: 1,5 mm² është më e vogël se 2,5 mm² e qarkut; lloji i kabllos NYY-J ndryshon nga NYM-J e qarkut.',
    );
  });
});
