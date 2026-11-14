import { describe, expect, it } from 'vitest';
import { callText, pickVoice, rankVoices, spokenNumber } from '../src/display/voice';

describe('calling an order out loud', () => {
  it('spells the number so the voice can’t misread it', () => {
    expect(spokenNumber('QA-07')).toBe('Q A zero seven');
    expect(spokenNumber('PB-012')).toBe('P B zero one two');
    expect(spokenNumber('cs01')).toBe('C S zero one');
  });

  it('says the number, their first name, and where to go', () => {
    expect(callText('QA-07', 'Leanna Marnelle Rosales')).toBe('Order Q A zero seven, for Leanna. Your order is ready. Please come to the counter.');
    expect(callText('PA-001')).toBe('Order P A zero zero one. Your order is ready. Please come to the counter.');
  });
});

describe('choosing the voice', () => {
  const v = (name: string, lang: string, localService: boolean) => ({ name, lang, localService });
  const laptop = [
    v('Microsoft David - English (United States)', 'en-US', true),
    v('Microsoft Zira - English (United States)', 'en-US', true),
    v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
    v('Microsoft Rosa Online (Natural) - English (Philippines)', 'en-PH', false),
    v('Microsoft Angelo Online (Natural) - Filipino (Philippines)', 'fil-PH', false),
    v('Google US English', 'en-US', false),
  ];

  it('puts natural women’s voices first, then the offline women’s voices, and leaves out other languages', () => {
    expect(rankVoices(laptop).map((x) => x.name.split(' ')[1])).toEqual(['Rosa', 'Aria', 'US', 'Zira', 'David']);
  });

  it('uses the voice picked in Settings, and an offline one when there’s no internet', () => {
    expect(pickVoice(laptop)?.name).toMatch(/Rosa/);
    expect(pickVoice(laptop, 'Microsoft Aria Online (Natural) - English (United States)')?.name).toMatch(/Aria/);
    expect(pickVoice(laptop, '', false)?.name).toMatch(/Zira/);
    expect(pickVoice(laptop, 'Microsoft Aria Online (Natural) - English (United States)', false)?.name).toMatch(/Zira/);
    expect(pickVoice(laptop, 'Microsoft David - English (United States)', false)?.name).toMatch(/David/);
    expect(pickVoice([])).toBeNull();
  });
});
