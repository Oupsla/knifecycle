import assert from 'assert';
import sinon from 'sinon';
import {
  reuseSpecialProps,
  wrapInitializer,
  parseDependencyDeclaration,
  name,
  type,
  inject,
  options,
  extra,
  initializer,
  handler,
  SPECIAL_PROPS,
} from './util';

function aProvider() {}

describe('reuseSpecialProps', () => {
  it('should work', () => {
    // We can safely ignore coverage here since the
    // function are here just as placeholders
    /* istanbul ignore next */
    function from() {
      return 'from';
    }
    /* istanbul ignore next */
    function to() {
      return 'to';
    }

    from.$name = 'from';
    from.$type = 'service';
    from.$inject = ['ki', 'kooo', 'lol'];
    from.$options = { singleton: false };
    from.$extra = { httpHandler: true };

    const newFn = reuseSpecialProps(from, to);

    assert.notEqual(newFn, to);
    assert.equal(newFn.$name, from.$name);
    assert.equal(newFn.$type, from.$type);
    assert.notEqual(newFn.$inject, from.$inject);
    assert.deepEqual(newFn.$inject, from.$inject);
    assert.notEqual(newFn.$options, from.$options);
    assert.deepEqual(newFn.$options, from.$options);
    assert.notEqual(newFn.$extra, from.$extra);
    assert.deepEqual(newFn.$extra, from.$extra);

    const newFn2 = reuseSpecialProps(from, to, {
      $name: 'yolo',
    });

    assert.notEqual(newFn2, to);
    assert.equal(newFn2.$name, 'yolo');
    assert.equal(newFn2.$type, from.$type);
    assert.notEqual(newFn2.$inject, from.$inject);
    assert.deepEqual(newFn2.$inject, from.$inject);
    assert.notEqual(newFn2.$options, from.$options);
    assert.deepEqual(newFn2.$options, from.$options);
    assert.notEqual(newFn.$extra, from.$extra);
    assert.deepEqual(newFn.$extra, from.$extra);
  });
});

describe('wrapInitializer', done => {
  it('should work', () => {
    function baseInitializer() {
      return Promise.resolve(() => 'test');
    }

    baseInitializer.$name = 'baseInitializer';
    baseInitializer.$type = 'service';
    baseInitializer.$inject = ['log'];
    baseInitializer.$options = { singleton: false };
    baseInitializer.$extra = { httpHandler: false };

    const log = sinon.stub();
    const newInitializer = wrapInitializer(({ log }, service) => {
      log('Wrapping...');
      return () => service() + '-wrapped';
    }, baseInitializer);

    newInitializer({ log })
      .then(service => {
        assert.equal(service(), 'test-wrapped');
        assert.deepEqual(log.args, [['Wrapping...']]);
      })
      .then(done)
      .catch(done);
  });
});

describe('inject', () => {
  it('should allow to decorate an initializer with dependencies', () => {
    const dependencies = ['ENV'];
    const newInitializer = inject(dependencies, aProvider);

    assert.notEqual(newInitializer, aProvider);
    assert.notEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
  });

  it('should allow to decorate an initializer with mapped dependencies', () => {
    const dependencies = ['ANOTHER_ENV>ENV'];
    const newInitializer = inject(dependencies, aProvider);

    assert.notEqual(newInitializer, aProvider);
    assert.notEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
  });
});

describe('options', () => {
  it('should allow to decorate an initializer with options', () => {
    const dependencies = ['ANOTHER_ENV>ENV'];
    const baseOptions = { singleton: true };
    const newInitializer = inject(
      dependencies,
      options(baseOptions, aProvider),
    );

    assert.notEqual(newInitializer, aProvider);
    assert.notEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.notEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
  });
});

describe('name', () => {
  it('should allow to decorate an initializer with a name', () => {
    const dependencies = ['ANOTHER_ENV>ENV'];
    const baseOptions = { singleton: true };
    const baseName = 'hash';
    const newInitializer = inject(
      dependencies,
      options(baseOptions, name(baseName, aProvider)),
    );

    assert.notEqual(newInitializer, aProvider);
    assert.notEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.notEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
    assert.equal(newInitializer[SPECIAL_PROPS.NAME], baseName);
  });
});

describe('extra', () => {
  it('should allow to decorate an initializer with extra infos', () => {
    const extraInformations = { httpHandler: true };
    const newInitializer = extra(extraInformations, aProvider);

    assert.notEqual(newInitializer, aProvider);
    assert.notEqual(newInitializer[SPECIAL_PROPS.EXTRA], extraInformations);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.EXTRA], extraInformations);
  });
});

describe('type', () => {
  it('should allow to decorate an initializer with a type', () => {
    const dependencies = ['ANOTHER_ENV>ENV'];
    const baseOptions = { singleton: true };
    const baseName = 'hash';
    const baseType = 'service';
    const newInitializer = inject(
      dependencies,
      options(baseOptions, name(baseName, type(baseType, aProvider))),
    );

    assert.notEqual(newInitializer, aProvider);
    assert.notEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.notEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
    assert.equal(newInitializer[SPECIAL_PROPS.NAME], baseName);
    assert.equal(newInitializer[SPECIAL_PROPS.TYPE], baseType);
  });
});

describe('initializer', () => {
  it('should allow to decorate an initializer with every properties', () => {
    const dependencies = ['ANOTHER_ENV>ENV'];
    const baseOptions = { singleton: true };
    const baseName = 'hash';
    const baseType = 'service';
    const newInitializer = initializer(
      {
        inject: dependencies,
        options: baseOptions,
        type: baseType,
        name: baseName,
      },
      aProvider,
    );

    assert.notEqual(newInitializer, aProvider);
    assert.notEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.INJECT], dependencies);
    assert.notEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
    assert.deepEqual(newInitializer[SPECIAL_PROPS.OPTIONS], baseOptions);
    assert.equal(newInitializer[SPECIAL_PROPS.NAME], baseName);
    assert.equal(newInitializer[SPECIAL_PROPS.TYPE], baseType);
  });
});

describe('handler', () => {
  it('should work', () => {
    const injectedServices = ['kikooo', 'lol'];
    const services = {
      kikooo: 'kikooo',
      lol: 'lol',
    };
    const theInitializer = handler(sampleHandler, injectedServices);

    assert.deepEqual(theInitializer.$name, sampleHandler.name);
    assert.deepEqual(theInitializer.$inject, ['kikooo', 'lol']);

    return theInitializer(services)
      .then(theHandler => theHandler('test'))
      .then(result =>
        assert.deepEqual(result, {
          deps: services,
          args: ['test'],
        }),
      );

    function sampleHandler(deps, ...args) {
      return Promise.resolve({ deps, args });
    }
  });

  it('should fail for anonymous functions', () => {
    assert.throws(() => {
      handler(() => {});
    }, /E_NO_HANDLER_NAME/);
  });
});

describe('parseDependencyDeclaration', () => {
  it('should work', () => {
    assert.deepEqual(parseDependencyDeclaration('pgsql>db'), {
      serviceName: 'pgsql',
      mappedName: 'db',
      optional: false,
    });
  });
});
