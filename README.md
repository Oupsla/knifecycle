# knifecycle
> Manage your NodeJS processes's lifecycle.

[![NPM version](https://img.shields.io/npm/v/knifecycle.svg)](https://www.npmjs.com/package/knifecycle)
[![Build Status](https://travis-ci.org/nfroidure/knifecycle.svg?branch=master)](https://travis-ci.org/nfroidure/knifecycle)
[![Dependency Status](https://david-dm.org/nfroidure/knifecycle.svg)](https://david-dm.org/nfroidure/knifecycle)
[![devDependency Status](https://david-dm.org/nfroidure/knifecycle/dev-status.svg)](https://david-dm.org/nfroidure/knifecycle#info=devDependencies)
[![Coverage Status](https://coveralls.io/repos/nfroidure/knifecycle/badge.svg?branch=master)](https://coveralls.io/r/nfroidure/knifecycle?branch=master)
[![Code Climate](https://codeclimate.com/github/nfroidure/knifecycle/badges/gpa.svg)](https://codeclimate.com/github/nfroidure/knifecycle)
[![Dependency Status](https://dependencyci.com/github/nfroidure/knifecycle/badge)](https://dependencyci.com/github/nfroidure/knifecycle)

Most (maybe all) applications rely on two kinds of dependencies.

**The code dependencies** are fully covered by require/system modules in a
 testable manner (with `mockery` or `System` directly). There is no need for
 another dependency management system if those libraries are pure functions
 (involve no global states at all).

Unfortunately, applications often rely on **global states** where the JavaScript
 module system shows its limits. This is where `knifecycle` enters the game.

It is largely inspired by the Angular service system except it should not
 provide code but access to global states (time, filesystem, db). It also
 have an important additional feature to shutdown processes which is really
 useful for back-end servers and doesn't exists in Angular.

## Features
- services management: start services taking their dependencies in count and
 shut them down the same way for graceful exits.
- easy end to end testing: just replace your services per your own mocks and
 stubs while ensuring your application integrity between testing and production.
- isolation: isolate processing in a clean manner, per concerns.
- functional programming ready: encapsulate global states allowing the rest of
 your application to be purely functional.
- no circular dependencies for services: while circular dependencies are not a
 problem within purely functional libraries (require allows it), it may be
 harmful for your services, knifecycle impeach that while providing an `$inject`
 service à la Angular to allow accessing existing services references.

## Usage

Using Knifecycle is all about declaring the services our application need. Some
 of them are simple constants:
```js
// services/core.js
// Core services that are often needed. The constant decorator allows you to
// declare values or simple functions managing global states

// Notice we are directly using the instance module that prepare the Knifecycle
// instance for us
import { constant } from 'knifecycle/instance';

// Add the process environment as a simple constant
constant('ENV', process.env);

// Add a function providing the current timestamp
constant('now', Date.now.bind(Date));

// Add a delay function
constant('delay', Promise.delay.bind(Promise));

// Add process lifetime utils
constant('waitSignal', function waitSignal(signal) {
  return new Promise((resolve, reject) => {
    process.once(signal, resolve.bind(null, signal));
  });
});
constant('exit', process.exit.bind(exit));
```

While others are services that may depend on higher level ones. By example a
 logger.

```js
// services/logger.js
// A log service that depends on the process environment
import { depends, service } from 'knifecycle/instance';
import Logger from 'logger';

// Register a service with the service method.
// A service function returns a service promise
service('logger',
  // Declare the service dependencies with the depends decorator
  depends(['ENV'],
    function logService({ ENV }) {
      let logger = new Logger({
        logFile: ENV.LOGFILE,
      });

      logger.log('info', 'Log service initialized!');

      return Promise.resolve(logger);
    }
  )
);
```

Let's add a db service too:
```js
// services/db.js
import { depends, provider } from 'knifecycle/instance';
import MongoClient from 'mongodb';

// Register a service with the provider method.
// A service provider returns a service descriptor promise exposing:
// - a mandatory service property containing the actual service
// - an optional shutdown function allowing to gracefully close the service
// - an optional error promise to handle the service failure
provider('db',
  // Declare the service dependencies with the depends decorator
  depends(['ENV', 'logger'],
  function dbProvider({ ENV, logger }) {
    return MongoClient.connect(ENV.DB_URI)
    .then(function(db) {
      let fatalErrorPromise = new Promise((resolve, reject) {
        db.once('error', reject);
      });

      logger.log('info', 'db service initialized!');

      return {
        servicePromise: db,
        shutdownProvider: db.close.bind(db, true),
        errorPromise: fatalErrorPromise,
      };
    });
  })
);
```

Adding an Express server
```js
// services/server.js
import { depends, constant, provider, service } from 'knifecycle/instance';
import express from 'express';

// Create an express app
constant('app', express());

// Setting a route to serve the current timestamp.
service('routes/time',
  depends('app', 'now', 'logger',
  function timeRoutesProvider() {
    return Promise.resolve()
    .then(() => {
      app.get('/time', (req, res, next) => {
        const curTime = now();

        logger.log('info', 'Sending the current time:', curTime);
        res.status(200).send(curTime);
      });
    });
  })
);

// Add an HTTP server service
provider('server',
  depends(['app', 'routes/time', 'logger', 'ENV'],
  function serverProvider({ app, logger, ENV }) {
    return new Promise((resolve, reject) => {
      app.listen(ENV.PORT, (server) => {
        logger.log('info', 'server listening on port ' + ENV.PORT + '!');
        resolve(server);
      });
    }).then(function(server) {
      let fatalErrorPromise = new Promise((resolve, reject) {
        db.once('error', reject);
      });

      function shutdownServer() {
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
        servicePromise: Promise.resolve(server),
        shutdownProvider: shutdownServer,
        errorPromise: fatalErrorPromise,
      };
    });
  })
);
```

Let's wire it altogether to bootstrap an express application:
```js
// app.js

import { run } from 'knifecycle/instance';
import * from './services/core';
import * from './services/log';
import * from './services/db';
import * from './services/server';

// At this point, nothing is running. To instanciate services, we have to create
// an execution silo using them
// Note that we required the $shutdown service implicitly created by knifecycle
run(['server', 'waitSignal', 'exit', '$shutdown'])
function main({ waitSignal, exit, $shutdown }) {
  // We want to exit gracefully when a SIG_TERM/INT signal is received
  Promise.any([
    waitSignal('SIGINT'),
    waitSignal('SIGTERM'),
  ])
  // The shutdown service will disable silos progressively and then the services
  // they rely on to finally resolve the returned promise once done
  .then($shutdown)
  .then(() => {
    // graceful shutdown was successful let's exit in peace
    process.exit(0);
  })
  .catch((err) => {
    console.error('Could not exit gracefully:', err);
    process.exit(1);
  });

}
```

## Debugging

Simply use the DEBUG env var by setting it to 'knifecycle':
```sh
DEBUG=knifecycle npm t
```

## Plans

This library is already used by the microservices i am working on at 7Digital
 but I plan to use it with the
 [Trip Story](https://github.com/nfroidure/TripStory) toy project in order to
 illustrate its usage on an open-source project. I think i will also use it for
 front-end projects too.

The scope of this library won't change. However the plan is:
- improve performances
- [allow to declare singleton services](https://github.com/nfroidure/knifecycle/issues/3)
- evolve with Node. You will never have to transpile this library to use it with Node.
- `depends`, `constant`, `service`, `provider` may become decorators;
- track bugs ;)

I'll also share most of my own services/providers and their stubs/mocks in order
to let you reuse it through your projects easily.

## Functions

<dl>
<dt><a href="#getInstance">getInstance()</a> ⇒ <code>Knifecycle</code></dt>
<dd><p>Returns a Knifecycle instance (always the same)</p>
</dd>
<dt><a href="#constant">constant(constantName, constantValue)</a> ⇒ <code>function</code></dt>
<dd><p>Register a constant service</p>
</dd>
<dt><a href="#service">service(serviceName, service)</a> ⇒ <code>function</code></dt>
<dd><p>Register a service</p>
</dd>
<dt><a href="#provider">provider(serviceName, serviceProvider)</a> ⇒ <code>Promise</code></dt>
<dd><p>Register a service provider</p>
</dd>
<dt><a href="#depends">depends(dependenciesNames, serviceProvider)</a> ⇒ <code>function</code></dt>
<dd><p>Decorator to claim that a service depends on others ones.</p>
</dd>
<dt><a href="#run">run(dependenciesNames)</a> ⇒ <code>Promise</code></dt>
<dd><p>Creates a new execution silo</p>
</dd>
<dt><a href="#_getServiceDescriptor">_getServiceDescriptor(siloContext, serviceName, serviceProvider)</a> ⇒ <code>Promise</code></dt>
<dd><p>Initialize or return a service descriptor</p>
</dd>
<dt><a href="#_initializeServiceDescriptor">_initializeServiceDescriptor(siloContext, serviceName, serviceProvider)</a> ⇒ <code>Promise</code></dt>
<dd><p>Initialize a service</p>
</dd>
<dt><a href="#_initializeDependencies">_initializeDependencies(siloContext, serviceName, servicesNames)</a> ⇒ <code>Promise</code></dt>
<dd><p>Initialize a service dependencies</p>
</dd>
</dl>

<a name="getInstance"></a>

## getInstance() ⇒ <code>Knifecycle</code>
Returns a Knifecycle instance (always the same)

**Kind**: global function  
**Returns**: <code>Knifecycle</code> - The created/saved instance  
**Example**  
```js
import Knifecycle from 'sf-knifecycle'

const $ = Knifecycle.getInstance();
```
<a name="constant"></a>

## constant(constantName, constantValue) ⇒ <code>function</code>
Register a constant service

**Kind**: global function  
**Returns**: <code>function</code> - The created service provider  

| Param | Type | Description |
| --- | --- | --- |
| constantName | <code>String</code> | The name of the service |
| constantValue | <code>any</code> | The constant value |

**Example**  
```js
import Knifecycle from 'sf-knifecycle'

const $ = new Knifecycle();

$.constant('ENV', process.env); // Expose the process env
$.constant('time', Date.now.bind(Date)); // Expose a time() function
```
<a name="service"></a>

## service(serviceName, service) ⇒ <code>function</code>
Register a service

**Kind**: global function  
**Returns**: <code>function</code> - The created service provider  

| Param | Type | Description |
| --- | --- | --- |
| serviceName | <code>String</code> | Service name |
| service | <code>function</code> &#124; <code>Promise</code> | The service promise or a function returning it |

**Example**  
```js
import Knifecycle from 'sf-knifecycle'
import fs from 'fs';

const $ = new Knifecycle();

$.service('config', function config() {
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
```
<a name="provider"></a>

## provider(serviceName, serviceProvider) ⇒ <code>Promise</code>
Register a service provider

**Kind**: global function  
**Returns**: <code>Promise</code> - The actual service descriptor promise  

| Param | Type | Description |
| --- | --- | --- |
| serviceName | <code>String</code> | Service name |
| serviceProvider | <code>function</code> | Service provider or a service provider promise |

**Example**  
```js
import Knifecycle from 'sf-knifecycle'
import fs from 'fs';

const $ = new Knifecycle();

$.provider('config', function configProvider() {
  return Promise.resolve({
    servicePromise: new Promise((resolve, reject) {
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
});
```
<a name="depends"></a>

## depends(dependenciesNames, serviceProvider) ⇒ <code>function</code>
Decorator to claim that a service depends on others ones.

**Kind**: global function  
**Returns**: <code>function</code> - Returns the decorator function  
**$.depends([&#x27;env&#x27;])**: $.service('config', function configProvider({ ENV }) {
  return new Promise((resolve, reject) {
    fs.readFile(ENV.CONFIG_FILE, function(err, data) {
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

| Param | Type | Description |
| --- | --- | --- |
| dependenciesNames | <code>Array.&lt;String&gt;</code> | Dependencies the decorated service provider depends on. |
| serviceProvider | <code>function</code> | Service provider or a service provider promise |

**Example**  
```js
import Knifecycle from 'knifecycle'
import fs from 'fs';

const $ = new Knifecycle();
```
<a name="run"></a>

## run(dependenciesNames) ⇒ <code>Promise</code>
Creates a new execution silo

**Kind**: global function  
**Returns**: <code>Promise</code> - Service descriptor promise.  

| Param | Type | Description |
| --- | --- | --- |
| dependenciesNames | <code>Array.&lt;String&gt;</code> | Service name. |

<a name="_getServiceDescriptor"></a>

## _getServiceDescriptor(siloContext, serviceName, serviceProvider) ⇒ <code>Promise</code>
Initialize or return a service descriptor

**Kind**: global function  
**Returns**: <code>Promise</code> - Service dependencies hash promise.  

| Param | Type | Description |
| --- | --- | --- |
| siloContext | <code>Object</code> | Current execution silo context |
| serviceName | <code>String</code> | Service name. |
| serviceProvider | <code>String</code> | Service provider. |

<a name="_initializeServiceDescriptor"></a>

## _initializeServiceDescriptor(siloContext, serviceName, serviceProvider) ⇒ <code>Promise</code>
Initialize a service

**Kind**: global function  
**Returns**: <code>Promise</code> - Service dependencies hash promise.  

| Param | Type | Description |
| --- | --- | --- |
| siloContext | <code>Object</code> | Current execution silo context |
| serviceName | <code>String</code> | Service name. |
| serviceProvider | <code>String</code> | Service provider. |

<a name="_initializeDependencies"></a>

## _initializeDependencies(siloContext, serviceName, servicesNames) ⇒ <code>Promise</code>
Initialize a service dependencies

**Kind**: global function  
**Returns**: <code>Promise</code> - Service dependencies hash promise.  

| Param | Type | Description |
| --- | --- | --- |
| siloContext | <code>Object</code> | Current execution silo siloContext |
| serviceName | <code>String</code> | Service name. |
| servicesNames | <code>String</code> | Dependencies names. |
