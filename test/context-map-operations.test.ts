import { expect, test } from 'bun:test';
import { operations } from '../src/core/operations.ts';

test('context-map operations are registered with CLI hints', () => {
  const build = operations.find((operation) => operation.name === 'build_context_map');
  const get = operations.find((operation) => operation.name === 'get_context_map_entry');
  const list = operations.find((operation) => operation.name === 'list_context_map_entries');

  expect(build?.cliHints?.name).toBe('map-build');
  expect(get?.cliHints?.name).toBe('map-get');
  expect(list?.cliHints?.name).toBe('map-list');
});
