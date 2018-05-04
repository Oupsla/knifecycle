import assert from 'assert';
import YError from 'yerror';
import buildInitializer from './build';
import { initializer } from './util';

describe('buildInitializer', () => {
  function aProvider() {}
  const mockedConstants = {
    NODE_ENV: 'development',
  };
  const mockedDepsHash = {
    dep1: initializer(
      {
        inject: [],
        options: {},
        type: 'service',
        name: 'dep1',
      },
      aProvider,
    ),
    dep2: initializer(
      {
        inject: ['dep1', 'NODE_ENV'],
        options: {},
        type: 'provider',
        name: 'dep2',
      },
      aProvider,
    ),
    dep3: initializer(
      {
        inject: ['dep2', 'dep1', '?depOpt'],
        options: {},
        type: 'service',
        name: 'dep3',
      },
      aProvider,
    ),
  };
  function mockedLoader(name) {
    return mockedDepsHash[name]
      ? Promise.resolve({
          path: `./services/${name}`,
          initializer: mockedDepsHash[name],
        })
      : Promise.reject(new YError('E_UNMATCHED_DEPENDENCY', name));
  }

  it('should build an initialization module', () =>
    buildInitializer(mockedConstants, mockedLoader, [
      'dep1',
      'finalMappedDep>dep3',
    ]).then(content => {
      assert.equal(
        content,
        `
// Definition batch #0
import initDep1 from './services/dep1';
const NODE_ENV = "development";

// Definition batch #1
import initDep2 from './services/dep2';

// Definition batch #2
import initDep3 from './services/dep3';

export async function initialize(services = {}) {
  // Initialization batch #0
  const batch0 = {
    dep1: initDep1({
    }),
    NODE_ENV: Promise.resolve(NODE_ENV),
  };

  await Promise.all(
    Object.keys(batch0)
    .map(key => batch0[key])
  );

  services['dep1'] = await batch0['dep1'];
  services['NODE_ENV'] = await batch0['NODE_ENV'];

  // Initialization batch #1
  const batch1 = {
    dep2: initDep2({
      dep1: services['dep1'],
      NODE_ENV: services['NODE_ENV'],
    }).then(provider => provider.service),
  };

  await Promise.all(
    Object.keys(batch1)
    .map(key => batch1[key])
  );

  services['dep2'] = await batch1['dep2'];

  // Initialization batch #2
  const batch2 = {
    dep3: initDep3({
      dep2: services['dep2'],
      dep1: services['dep1'],
      depOpt: services['depOpt'],
    }),
  };

  await Promise.all(
    Object.keys(batch2)
    .map(key => batch2[key])
  );

  services['dep3'] = await batch2['dep3'];

  return {
    dep1: services['dep1'],
    finalMappedDep: services['dep3'],
  };
}
`,
      );
    }));
});