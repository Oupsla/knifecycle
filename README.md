<!--
# This file is automatically generated by a `metapak`
# module. Do not change it elsewhere, changes would
# be overriden.
-->
# knifecycle
> Manage your NodeJS processes's lifecycle.

[![NPM version](https://badge.fury.io/js/knifecycle.svg)](https://npmjs.org/package/knifecycle)
[![Build status](https://secure.travis-ci.org/nfroidure/knifecycle.svg)](https://travis-ci.org/nfroidure/knifecycle)
[![Dependency Status](https://david-dm.org/nfroidure/knifecycle.svg)](https://david-dm.org/nfroidure/knifecycle)
[![devDependency Status](https://david-dm.org/nfroidure/knifecycle/dev-status.svg)](https://david-dm.org/nfroidure/knifecycle#info=devDependencies)
[![Coverage Status](https://coveralls.io/repos/nfroidure/knifecycle/badge.svg?branch=master)](https://coveralls.io/r/nfroidure/knifecycle?branch=master)
[![Code Climate](https://codeclimate.com/github/nfroidure/knifecycle.svg)](https://codeclimate.com/github/nfroidure/knifecycle)
[![Dependency Status](https://dependencyci.com/github/nfroidure/knifecycle/badge)](https://dependencyci.com/github/nfroidure/knifecycle)

Most (maybe all) applications rely on two kinds of dependencies.

**The code dependencies** are fully covered by require/system
 modules in a testable manner (with `mockery` or `System`
 directly). There is no need for another dependency management
 system if those libraries are pure functions (involve no
 global states at all).

Unfortunately, applications often rely on **global states**
 where the JavaScript module system shows its limits. This
 is where `knifecycle` enters the game.

It is largely inspired by the Angular service system except
 it should not provide code but access to global states
 (time, filesystem, db). It also have an important additional
 feature to shutdown processes which is really useful for
 back-end servers and doesn't exists in Angular.

You may want to look at the
 [architecture notes](./ARCHITECTURE.md) to better handle the
 reasonning behind `knifecycle` and its implementation.

At this point you may think that a DI system is useless. My
 advice is that it depends. But at least, you should not
 make a definitive choice and allow both approaches. See
 [this Stack Overflow anser](http://stackoverflow.com/questions/9250851/do-i-need-dependency-injection-in-nodejs-or-how-to-deal-with/44084729#44084729)
 for more context about this statement.

## Features
- services management: start services taking their dependencies
 in count and shut them down the same way for graceful exits
 (namely dependency injection with inverted control);
- singleton: maintain singleton services across several running
 execution silos.
- easy end to end testing: just replace your services per your
 own mocks and stubs while ensuring your application integrity
 between testing and production;
- isolation: isolate processing in a clean manner, per concerns;
- functional programming ready: encapsulate global states
 allowing the rest of your application to be purely functional;
- no circular dependencies for services: while circular
 dependencies are not a problem within purely functional
 libraries (require allows it), it may be harmful for your
 services, `knifecycle` impeach that while providing an
 `$injector` service à la Angular to allow accessing existing
 services references if you really need to;
- generate Mermaid graphs of the dependency tree.

## Usage

Using `knifecycle` is all about declaring the services our
 application needs and running your application over it.

Let's say we are building a web service. First, we need to
 handle a configuration file so we are creating an
 initializer to instanciate our `CONFIG` service:
```js
// services/config.js
import fs from 'fs';
import { initializer } from 'knifecycle';

// We are using the `initializer` decorator to
// declare our service initializer specificities
// Note that the initializer` decorator is pure
// so it just adds static informations and do not
// register the initializer to the provider yet.
export const initConfig = initializer({
  // we have to give our final service a name
  // for further use in other services injections
  name: 'CONFIG',
  // we will need an `ENV` variable in the initializer
  // so adding it in the injected dependencies.
  inject: ['ENV'],
  // our initializer is simple so we use the `service`
  // type for the initializer which just indicate that
  // the initializer will return a promise of the actual
  // service
  type: 'service',
  // We don't want to read the config file everytime we
  // inject it so declaring it as a singleton
  options: { singleton: true },
// Here is the actual initializer implementation, you
// can notice that it expect the `ENV` dependency to
// be set as a property of an object in first argument.
}, ({ ENV }) => {
  return new Promise((resolve, reject) {
    fs.readFile(ENV.CONFIG_PATH, function(err, data) {
      if(err) {
        return reject(err);
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
  }, 'utf-8');
});
```

Our service also uses a database so let's write an
 initializer for it:
 ```js
 // services/db.js
 import { initializer } from 'knifecycle';

const initDB = initializer({
  name: 'db',
  // Here we are injecting the previous `CONFIG` service
  // plus an optional one. If it does not exist then it
  // will silently fail and the service will be undefined.
  inject: ['CONFIG', '?log'],
  // The initializer type is slightly different. Indeed,
  // we need to manage the database connection errors
  // and wait for it to flush before shutting down the
  // process.
  // A service provider returns a promise of a provider
  // descriptor exposing:
  // - a mandatory `service` property containing the
  // actual service;
  // - an optional `dispose` function allowing to
  // gracefully close the service;
  // - an optional `fatalErrorPromise` property to
  // handle the service unrecoverable failure.
  type: 'provider',,
  options: { singleton: true },
}, ({ CONFIG, log }) {
   return MongoClient.connect(CONFIG.DB_URI)
   .then(function(db) {
     let fatalErrorPromise = new Promise((resolve, reject) {
       db.once('error', reject);
     });

     // Logging only if the `log` service is defined
     log && log('info', 'db service initialized!');

     return {
       service: db,
       dispose: db.close.bind(db, true),
       fatalErrorPromise,
     };
   });
 }
 ```

We need a last initializer for the HTTP server itself:
```js
// services/server.js
import { initializer } from 'knifecycle';
import express from 'express';

const initDB = initializer({
  name: 'server',
  inject: ['ENV', 'CONFIG', '?log'],
  options: { singleton: true },
}, ({ ENV, CONFIG, log }) => {
  const app = express();

  return new Promise((resolve, reject) => {
    const port = ENV.PORT || CONFIG.PORT;
    const server = app.listen(port, () => {
      log && log('info', `server listening on port ${port}!`);
      resolve(server);
    });
  }).then(function(server) {
    let fatalErrorPromise = new Promise((resolve, reject) {
      app.once('error', reject);
      server.once('error', reject);
    });

    function dispose() {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if(err) {
            reject(err);
            return;
          }
          resolve();
        })
      });
    }

    return {
      service: app,
      dispose,
      fatalErrorPromise,
    };
  });
});
```

Great! We are ready to make it work altogether:
```js
import { getInstance } from 'knifecycle';
import initConfig from 'services/config';
import initDB from 'services/db';
import initServer from 'services/server';

// We need only one Knifecycle instance so using
// a the singleton API
getInstance()
// Registering our initializers
.register(initConfig)
.register(initServer)
.register(initDB)
// Let's say we need to have another `db`
// service pointing to another db server.
.register(
  // First we remap the injected dependencies. It will
  // take the `DB2_CONFIG` service and inject it as
  // `CONFIG`
  inject(['DB2_CONFIG>CONFIG', '?log'],
    // Then we override its name
    name('db2', initDB)
  )
)
// Finally, we have to create the `DB2_CONFIG` service
// on which the `db2` service now depends on
.register(name('DB2_CONFIG', inject(['CONFIG'], ({ CONFIG }) => {
  // Let's just pick up the `db2` uri in the `CONFIG`
  // service
  return Promise.resolve({
    DB_URI: CONFIG.DB2_URI,
  });
})))
// Add the process environment as a simple constant
.constant('ENV', process.env)
// Add a function providing the current timestamp
.constant('now', Date.now.bind(Date))
// Add a delay function
.constant('delay', Promise.delay.bind(Promise))
// Add process lifetime utils
.constant('waitSignal', function waitSignal(signal) {
  return new Promise((resolve, reject) => {
    process.once(signal, resolve.bind(null, signal));
  });
})
.constant('exit', process.exit.bind(exit))
// Setting a route to serve the current timestamp.
.register(name('timeRoute',
  inject(
    ['server', 'now', '?log'],
    ({ server: app, now, log }) {
      return Promise.resolve()
      .then(() => {
        app.get('/time', (req, res, next) => {
          const curTime = now();

          log && log('info', 'Sending the current time:', curTime);
          res.status(200).send(curTime);
        });
      });
    }
  )
))

// At this point, nothing is running. To instanciate
// services, we have to create an execution silo using
// them. Note that we required the `$destroy` service
// implicitly created by `knifecycle`
.run(['server', 'timeRoute', 'waitSignal', 'exit', '$destroy'])
// Note that despite we injected them, we do not take
// back the `server` and `timeRoute` services. We only
// need them to get up and running but do not need to
// operate on them
.then(({ waitSignal, exit, $destroy }) {
  // We want to exit gracefully when a SIG_TERM/INT
  // signal is received
  Promise.any([
    waitSignal('SIGINT'),
    waitSignal('SIGTERM'),
  ])
  // The `$destroy` service will disable all silos
  // progressively and then the services they rely
  // on to finally resolve the returned promise
  // once done
  .then($destroy)
  .then(() => {
    // graceful shutdown was successful let's exit
    // in peace
    exit(0);
  })
  .catch((err) => {
    console.error('Could not exit gracefully:', err);
    exit(1);
  });

})
.catch((err) => {
  console.error('Could not launch the app:', err);
  process.exit(1);
});
```

## Debugging

Simply use the DEBUG environment variable by setting it to
 'knifecycle':
```sh
DEBUG=knifecycle npm t
```

## Plans

The scope of this library won't change. However the plan is:
- improve performances;
- evolve with Node: I may not need to transpile this library at
 some point.
- track bugs ;).

I'll also share most of my own initializers and their
 stubs/mocks in order to let you reuse it through
 your projects easily.

# API
## Classes

<dl>
<dt><a href="#Knifecycle">Knifecycle</a></dt>
<dd></dd>
</dl>

## Functions

<dl>
<dt><a href="#reuseSpecialProps">reuseSpecialProps(from, to, [amend])</a> ⇒ <code>function</code></dt>
<dd><p>Apply special props to the given function from another one</p>
</dd>
<dt><a href="#wrapInitializer">wrapInitializer(wrapper, baseInitializer)</a> ⇒ <code>function</code></dt>
<dd><p>Allows to wrap an initializer to add extra</p>
</dd>
<dt><a href="#inject">inject(dependenciesDeclarations, initializer, [merge])</a> ⇒ <code>function</code></dt>
<dd><p>Decorator creating a new initializer with some
 dependencies declarations appended to it.</p>
</dd>
<dt><a href="#options">options(options, initializer, [merge])</a> ⇒ <code>function</code></dt>
<dd><p>Decorator to amend an initializer options.</p>
</dd>
<dt><a href="#name">name(name, initializer)</a> ⇒ <code>function</code></dt>
<dd><p>Decorator to set an initializer name.</p>
</dd>
<dt><a href="#type">type(type, initializer)</a> ⇒ <code>function</code></dt>
<dd><p>Decorator to set an initializer type.</p>
</dd>
<dt><a href="#initializer">initializer(properties, initializer)</a> ⇒ <code>function</code></dt>
<dd><p>Decorator to set an initializer properties.</p>
</dd>
<dt><a href="#parseDependencyDeclaration">parseDependencyDeclaration(dependencyDeclaration)</a> ⇒ <code>Object</code></dt>
<dd><p>Explode a dependency declaration an returns its parts.</p>
</dd>
</dl>

<a name="Knifecycle"></a>

## Knifecycle
**Kind**: global class  

* [Knifecycle](#Knifecycle)
    * [new Knifecycle()](#new_Knifecycle_new)
    * _instance_
        * [.constant(constantName, constantValue)](#Knifecycle+constant) ⇒ [<code>Knifecycle</code>](#Knifecycle)
        * [.service(serviceName, initializer, options)](#Knifecycle+service) ⇒ [<code>Knifecycle</code>](#Knifecycle)
        * [.provider(serviceName, initializer, options)](#Knifecycle+provider) ⇒ [<code>Knifecycle</code>](#Knifecycle)
        * [.toMermaidGraph(options)](#Knifecycle+toMermaidGraph) ⇒ <code>String</code>
        * [.run(dependenciesDeclarations)](#Knifecycle+run) ⇒ <code>Promise</code>
        * [._getServiceDescriptor(siloContext, injectOnly, serviceName, serviceProvider)](#Knifecycle+_getServiceDescriptor) ⇒ <code>Promise</code>
        * [._initializeServiceDescriptor(siloContext, serviceName, serviceProvider)](#Knifecycle+_initializeServiceDescriptor) ⇒ <code>Promise</code>
        * [._initializeDependencies(siloContext, serviceName, servicesDeclarations, injectOnly)](#Knifecycle+_initializeDependencies) ⇒ <code>Promise</code>
    * _static_
        * [.getInstance()](#Knifecycle.getInstance) ⇒ [<code>Knifecycle</code>](#Knifecycle)

<a name="new_Knifecycle_new"></a>

### new Knifecycle()
Create a new Knifecycle instance

**Returns**: [<code>Knifecycle</code>](#Knifecycle) - The Knifecycle instance  
**Example**  
```js
import Knifecycle from 'knifecycle'

const $ = new Knifecycle();
```
<a name="Knifecycle+constant"></a>

### knifecycle.constant(constantName, constantValue) ⇒ [<code>Knifecycle</code>](#Knifecycle)
Register a constant service

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: [<code>Knifecycle</code>](#Knifecycle) - The Knifecycle instance (for chaining)  

| Param | Type | Description |
| --- | --- | --- |
| constantName | <code>String</code> | The name of the service |
| constantValue | <code>any</code> | The constant value |

**Example**  
```js
import Knifecycle from 'knifecycle'

const $ = new Knifecycle();

// Expose the process env
$.constant('ENV', process.env);
// Expose a time() function
$.constant('time', Date.now.bind(Date));
```
<a name="Knifecycle+service"></a>

### knifecycle.service(serviceName, initializer, options) ⇒ [<code>Knifecycle</code>](#Knifecycle)
Register a service initializer

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: [<code>Knifecycle</code>](#Knifecycle) - The Knifecycle instance (for chaining)  

| Param | Type | Description |
| --- | --- | --- |
| serviceName | <code>String</code> | Service name |
| initializer | <code>function</code> | An initializer returning the service promise |
| options | <code>Object</code> | Options attached to the initializer |

**Example**  
```js
import Knifecycle from 'knifecycle'
import fs from 'fs';

const $ = new Knifecycle();

$.service('config', configServiceInitializer, {
  singleton: true,
});

function configServiceInitializer({ CONFIG_PATH }) {
  return new Promise((resolve, reject) {
    fs.readFile(CONFIG_PATH, function(err, data) {
      if(err) {
        return reject(err);
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
  }, 'utf-8');
}
```
<a name="Knifecycle+provider"></a>

### knifecycle.provider(serviceName, initializer, options) ⇒ [<code>Knifecycle</code>](#Knifecycle)
Register a provider initializer

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: [<code>Knifecycle</code>](#Knifecycle) - The Knifecycle instance (for chaining)  

| Param | Type | Description |
| --- | --- | --- |
| serviceName | <code>String</code> | Service name resolved by the provider |
| initializer | <code>function</code> | An initializer returning the service promise |
| options | <code>Object</code> | Options attached to the initializer |

**Example**  
```js
import Knifecycle from 'knifecycle'
import fs from 'fs';

const $ = new Knifecycle();

$.provider('config', function configProvider() {
  return new Promise((resolve, reject) {
    fs.readFile('config.js', function(err, data) {
      let config;
      if(err) {
        return reject(err);
      }
      try {
        config = JSON.parse(data.toString);
      } catch (err) {
        return reject(err);
      }
      resolve({
        service: config,
      });
    });
  });
});
```
<a name="Knifecycle+toMermaidGraph"></a>

### knifecycle.toMermaidGraph(options) ⇒ <code>String</code>
Outputs a Mermaid compatible dependency graph of the declared services.
See [Mermaid docs](https://github.com/knsv/mermaid)

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: <code>String</code> - Returns a string containing the Mermaid dependency graph  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | Options for generating the graph (destructured) |
| options.shapes | <code>Array.&lt;Object&gt;</code> | Various shapes to apply |
| options.styles | <code>Array.&lt;Object&gt;</code> | Various styles to apply |
| options.classes | <code>Object</code> | A hash of various classes contents |

**Example**  
```js
import { Knifecycle, inject } from 'knifecycle';
import appInitializer from './app';

const $ = new Knifecycle();

$.constant('ENV', process.env);
$.constant('OS', require('os'));
$.service('app', inject(['ENV', 'OS'], appInitializer));
$.toMermaidGraph();

// returns
graph TD
  app-->ENV
  app-->OS
```
<a name="Knifecycle+run"></a>

### knifecycle.run(dependenciesDeclarations) ⇒ <code>Promise</code>
Creates a new execution silo

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: <code>Promise</code> - Service descriptor promise  

| Param | Type | Description |
| --- | --- | --- |
| dependenciesDeclarations | <code>Array.&lt;String&gt;</code> | Service name. |

**Example**  
```js
import Knifecycle from 'knifecycle'

const $ = new Knifecycle();

$.constant('ENV', process.env);
$.run(['ENV'])
.then(({ ENV }) => {
 // Here goes your code
})
```
<a name="Knifecycle+_getServiceDescriptor"></a>

### knifecycle._getServiceDescriptor(siloContext, injectOnly, serviceName, serviceProvider) ⇒ <code>Promise</code>
Initialize or return a service descriptor

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: <code>Promise</code> - Service dependencies hash promise.  

| Param | Type | Description |
| --- | --- | --- |
| siloContext | <code>Object</code> | Current execution silo context |
| injectOnly | <code>Boolean</code> | Flag indicating if existing services only should be used |
| serviceName | <code>String</code> | Service name. |
| serviceProvider | <code>String</code> | Service provider. |

<a name="Knifecycle+_initializeServiceDescriptor"></a>

### knifecycle._initializeServiceDescriptor(siloContext, serviceName, serviceProvider) ⇒ <code>Promise</code>
Initialize a service

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: <code>Promise</code> - Service dependencies hash promise.  

| Param | Type | Description |
| --- | --- | --- |
| siloContext | <code>Object</code> | Current execution silo context |
| serviceName | <code>String</code> | Service name. |
| serviceProvider | <code>String</code> | Service provider. |

<a name="Knifecycle+_initializeDependencies"></a>

### knifecycle._initializeDependencies(siloContext, serviceName, servicesDeclarations, injectOnly) ⇒ <code>Promise</code>
Initialize a service dependencies

**Kind**: instance method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: <code>Promise</code> - Service dependencies hash promise.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| siloContext | <code>Object</code> |  | Current execution silo siloContext |
| serviceName | <code>String</code> |  | Service name. |
| servicesDeclarations | <code>String</code> |  | Dependencies declarations. |
| injectOnly | <code>Boolean</code> | <code>false</code> | Flag indicating if existing services only should be used |

<a name="Knifecycle.getInstance"></a>

### Knifecycle.getInstance() ⇒ [<code>Knifecycle</code>](#Knifecycle)
Returns a Knifecycle instance (always the same)

**Kind**: static method of [<code>Knifecycle</code>](#Knifecycle)  
**Returns**: [<code>Knifecycle</code>](#Knifecycle) - The created/saved instance  
**Example**  
```js
import { getInstance } from 'knifecycle'

const $ = getInstance();
```
<a name="reuseSpecialProps"></a>

## reuseSpecialProps(from, to, [amend]) ⇒ <code>function</code>
Apply special props to the given function from another one

**Kind**: global function  
**Returns**: <code>function</code> - The newly built function  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| from | <code>function</code> |  | The initialization function in which to pick the props |
| to | <code>function</code> |  | The initialization function from which to build the new one |
| [amend] | <code>Object</code> | <code>{}</code> | Some properties to override |

<a name="wrapInitializer"></a>

## wrapInitializer(wrapper, baseInitializer) ⇒ <code>function</code>
Allows to wrap an initializer to add extra

**Kind**: global function  
**Returns**: <code>function</code> - The new initializer  

| Param | Type | Description |
| --- | --- | --- |
| wrapper | <code>function</code> | A function taking dependencies and the base service in arguments |
| baseInitializer | <code>function</code> | The initializer to decorate |

<a name="inject"></a>

## inject(dependenciesDeclarations, initializer, [merge]) ⇒ <code>function</code>
Decorator creating a new initializer with some
 dependencies declarations appended to it.

**Kind**: global function  
**Returns**: <code>function</code> - Returns a new initializer  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| dependenciesDeclarations | <code>Array.&lt;String&gt;</code> |  | List of dependencies declarations to declare which  services the initializer needs to resolve its  own service. |
| initializer | <code>function</code> |  | The initializer to tweak |
| [merge] | <code>Boolean</code> | <code>false</code> | Whether dependencies should be merged with existing  ones or not |

**Example**  
```js
import { inject, getInstance } from 'knifecycle'
import myServiceInitializer from './service';

getInstance()
.service('myService',
  inject(['ENV'], myServiceInitializer)
);
```
<a name="options"></a>

## options(options, initializer, [merge]) ⇒ <code>function</code>
Decorator to amend an initializer options.

**Kind**: global function  
**Returns**: <code>function</code> - Returns a new initializer  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | <code>Object</code> |  | Options to set to the initializer |
| options.singleton | <code>Object</code> |  | Define the initializer service as a singleton (one instance for several runs) |
| initializer | <code>function</code> |  | The initializer to tweak |
| [merge] | <code>function</code> | <code>true</code> | Whether options should be merged or not |

**Example**  
```js
import { inject, options, getInstance } from 'knifecycle';
import myServiceInitializer from './service';

getInstance()
.service('myService',
  inject(['ENV'],
    options({ singleton: true}, myServiceInitializer)
  )
);
```
<a name="name"></a>

## name(name, initializer) ⇒ <code>function</code>
Decorator to set an initializer name.

**Kind**: global function  
**Returns**: <code>function</code> - Returns a new initializer with that name set  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>String</code> | The name of the service the initializer resolves to. |
| initializer | <code>function</code> | The initializer to tweak |

**Example**  
```js
import { name, getInstance } from 'knifecycle';
import myServiceInitializer from './service';

getInstance()
.register(name('myService', myServiceInitializer));
```
<a name="type"></a>

## type(type, initializer) ⇒ <code>function</code>
Decorator to set an initializer type.

**Kind**: global function  
**Returns**: <code>function</code> - Returns a new initializer  

| Param | Type | Description |
| --- | --- | --- |
| type | <code>String</code> | The type to set to the initializer. |
| initializer | <code>function</code> | The initializer to tweak |

**Example**  
```js
import { name, type, getInstance } from 'knifecycle';
import myServiceInitializer from './service';

getInstance()
.register(
  type('service',
    name('myService',
      myServiceInitializer
    )
  )
 );
```
<a name="initializer"></a>

## initializer(properties, initializer) ⇒ <code>function</code>
Decorator to set an initializer properties.

**Kind**: global function  
**Returns**: <code>function</code> - Returns a new initializer  

| Param | Type | Description |
| --- | --- | --- |
| properties | <code>Object</code> | Properties to set to the service. |
| initializer | <code>function</code> | The initializer to tweak |

**Example**  
```js
import { initializer, getInstance } from 'knifecycle';
import myServiceInitializer from './service';

getInstance()
.register(initializer({
  name: 'myService',
  type: 'service',
  inject: ['ENV'],
  options: { singleton: true }
}, myServiceInitializer));
```
<a name="parseDependencyDeclaration"></a>

## parseDependencyDeclaration(dependencyDeclaration) ⇒ <code>Object</code>
Explode a dependency declaration an returns its parts.

**Kind**: global function  
**Returns**: <code>Object</code> - The various parts of it  

| Param | Type | Description |
| --- | --- | --- |
| dependencyDeclaration | <code>String</code> | A dependency declaration string |

**Example**  
```js
parseDependencyDeclaration('pgsql>db');
// Returns
{
  serviceName: 'pgsql',
  mappedName: 'db',
  optional: false,
}
```

# License
[MIT](https://github.com/nfroidure/knifecycle/blob/master/LICENSE)
