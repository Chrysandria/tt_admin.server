import { matchFacebookProductMessage } from './facebook-message.js';

describe('matchFacebookProductMessage', () => {
  const products = [
    {
      id: '1',
      nom: 'Robe bleue',
      keywords: ['robe azur', 'robe bleu'],
    },
    { id: '2', nom: 'Sac rouge', keywords: ['sac à main', 'sac'] },
    { id: '3', nom: 'Robe noire', keywords: ['robe sombre'] },
  ];

  it('matches the product name and configured keywords without accents or case sensitivity', () => {
    expect(matchFacebookProductMessage('ROBE AZUR', products)).toEqual({
      kind: 'match',
      items: [{ product: products[0], quantity: 1 }],
    });
    expect(matchFacebookProductMessage('je veux une robe a main', products)).toEqual({
      kind: 'none',
    });
    expect(matchFacebookProductMessage('Je veux un sac a main', products)).toEqual({
      kind: 'match',
      items: [{ product: products[1], quantity: 1 }],
    });
  });

  it('parses quantities before or after a keyword phrase', () => {
    expect(
      matchFacebookProductMessage('Je veux 2 robe bleue et sac rouge x3', products),
    ).toEqual({
      kind: 'match',
      items: [
        { product: products[0], quantity: 2 },
        { product: products[1], quantity: 3 },
      ],
    });
  });

  it('accepts French number words and aggregates repeated products', () => {
    expect(
      matchFacebookProductMessage(
        'deux robe azur et une robe bleue',
        products,
      ),
    ).toEqual({
      kind: 'match',
      items: [{ product: products[0], quantity: 3 }],
    });
  });

  it('identifies multiple products from one message', () => {
    expect(
      matchFacebookProductMessage(
        'Bonjour, je prends sac à main 1 et robe sombre 2',
        products,
      ),
    ).toEqual({
      kind: 'match',
      items: [
        { product: products[1], quantity: 1 },
        { product: products[2], quantity: 2 },
      ],
    });
  });

  it('rejects invalid quantities', () => {
    expect(matchFacebookProductMessage('Sac rouge 0', products)).toEqual({
      kind: 'invalid-quantity',
    });
    expect(
      matchFacebookProductMessage('Sac rouge 9007199254740992', products),
    ).toEqual({ kind: 'invalid-quantity' });
    expect(matchFacebookProductMessage('un sac rouge 2', products)).toEqual({
      kind: 'invalid-quantity',
    });
  });

  it('does not match partial words or unrelated messages', () => {
    expect(matchFacebookProductMessage('robe', products)).toEqual({
      kind: 'none',
    });
    expect(matchFacebookProductMessage('bonjour', products)).toEqual({
      kind: 'none',
    });
  });

  it('rejects keywords shared by different products as ambiguous', () => {
    expect(
      matchFacebookProductMessage('sac', [
        ...products,
        { id: '4', nom: 'Petit sac', keywords: ['sac'] },
      ]),
    ).toEqual({ kind: 'ambiguous' });
  });

  it('prefers the most specific phrase when product names overlap', () => {
    expect(
      matchFacebookProductMessage('robe noire', [
        { id: '5', nom: 'Robe', keywords: [] },
        { id: '6', nom: 'Robe noire', keywords: [] },
      ]),
    ).toEqual({
      kind: 'match',
      items: [
        {
          product: { id: '6', nom: 'Robe noire', keywords: [] },
          quantity: 1,
        },
      ],
    });
  });
});
