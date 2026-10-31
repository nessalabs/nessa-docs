import { expect, it } from 'vitest';
import { z } from 'zod';
import { portableSchema } from './schema';

it('changes only nullable JSON Schema spelling and keeps runtime validation', async () => {
  const original = z.object({ fragment: z.string().nullable() });
  const portable = portableSchema(original)['~standard'];
  const schema = portable.jsonSchema.output({ target: 'draft-2020-12' });
  expect(schema).toMatchObject({ properties: { fragment: { anyOf: [{ type: 'string' }, { type: 'null' }] } } });
  for (const value of [{ fragment: null }, { fragment: 'section' }, { fragment: 1 }, {}]) {
    const result = await portable.validate(value);
    expect('issues' in result && !!result.issues).toBe(!original.safeParse(value).success);
  }
});

it('does not rewrite literal example data with a property named type', () => {
  const example = { type: ['string', 'null'] };
  const original = z.object({ type: z.string().nullable() }).meta({ examples: [example] });
  const schema = portableSchema(original)['~standard'].jsonSchema.output({ target: 'draft-2020-12' });
  expect(schema.examples).toEqual([example]);
  expect(schema).toMatchObject({ properties: { type: { anyOf: [{ type: 'string' }, { type: 'null' }] } } });
});
