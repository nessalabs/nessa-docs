import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

const MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);
const SINGLE = new Set(['additionalProperties', 'additionalItems', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema']);
const ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

// Visit schema positions only: literal enum/const/default/examples data must
// keep its own meaning, including any object property named "type".
function portable(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const schema: Record<string, unknown> = { ...value };
  for (const [key, child] of Object.entries(schema)) {
    if (MAPS.has(key) && child && typeof child === 'object' && !Array.isArray(child)) {
      schema[key] = Object.fromEntries(Object.entries(child).map(([name, sub]) => [name, portable(sub)]));
    } else if (SINGLE.has(key)) schema[key] = portable(child);
    else if ((ARRAYS.has(key) || key === 'items') && Array.isArray(child)) schema[key] = child.map(portable);
    else if (key === 'items') schema[key] = portable(child);
  }
  if (!Array.isArray(schema.type)) return schema;
  const { type, ...rest } = schema;
  const constraint = { anyOf: type.map((type: unknown) => ({ type })) };
  return Object.hasOwn(rest, 'anyOf') ? { allOf: [rest, constraint] } : { ...rest, ...constraint };
}

// Preserve the validator and nullable values; only JSON Schema spelling changes
// for hosts whose dialect accepts one type string rather than a type array.
export function portableSchema<S extends StandardSchemaWithJSON>(schema: S): StandardSchemaWithJSON {
  const standard = schema['~standard'];
  return { '~standard': { ...standard, jsonSchema: {
    input: (options) => portable(standard.jsonSchema.input(options)) as Record<string, unknown>,
    output: (options) => portable(standard.jsonSchema.output(options)) as Record<string, unknown>,
  } } };
}
