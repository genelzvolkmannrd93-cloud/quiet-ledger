import assert from 'node:assert/strict';
import test from 'node:test';
import { english, translate } from '../src/i18n.ts';
import { extraTranslations } from '../src/translations.ts';
import { intlLocale, locales } from '../src/domain.ts';

test('German and Spanish cover every message and preserve template placeholders', () => {
  for (const [key, source] of Object.entries(english)) {
    const pair = extraTranslations[source];
    assert.ok(pair, `Missing translations: ${key}`);
    for (const text of pair) {
      assert.ok(text.trim().length);
      assert.deepEqual([...text.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort(), [...source.matchAll(/\{\w+\}/g)].map((match) => match[0]).sort());
    }
  }
});
test('all supported locales format dates and interpolate account-safe labels', () => {
  assert.equal(translate('es', 'Добрый день, {name}', { name: 'Alex' }), 'Hola, Alex');
  assert.equal(translate('de', 'Добрый день, {name}', { name: 'Alex' }), 'Hallo, Alex');
  for (const locale of locales) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat(intlLocale(locale)).format(new Date()));
  }
});
