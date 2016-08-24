import YError from 'yerror';
import initDebug from 'debug';

const debug = initDebug('knifecycle');

const SHUTDOWN = '$shutdown';
const E_UNMATCHED_DEPENDENCY = 'E_UNMATCHED_DEPENDENCY';
const E_CIRCULAR_DEPENDENCY = 'E_CIRCULAR_DEPENDENCY';

// Constants that should use Symbol whenever possible
const INSTANCE = '__instance';
const DEPENDENCIES = '__dependencies';

export default class Knifecycle {
  /**
   * Create a new Knifecycle instance
   * @return {Knifecycle}     The Knifecycle instance
   * @example
   *
   * import Knifecycle from 'sf-knifecycle'
   *
   * const $ = new Knifecycle();
   */
  constructor() {
    this._servicesProviders = new Map();
  }

  /**
   * Returns a Knifecycle instance (always the same)
   * @return {Knifecycle}         The created/saved instance
   * @example
   *
   * import Knifecycle from 'sf-knifecycle'
   *
   * const $ = Knifecycle.getInstance();
   */
  static getInstance() {
    Knifecycle[INSTANCE] = Knifecycle[INSTANCE] || new Knifecycle();
    debug('Spawning an instance.');
    return Knifecycle[INSTANCE];
  }

  /**
   * Register a constant service
   * @param  {String} constantName    The name of the service
   * @param  {any}    constantValue   The constant value
   * @return {Function}               The created service provider
   * @example
   *
   * import Knifecycle from 'sf-knifecycle'
   *
   * const $ = new Knifecycle();
   *
   * $.constant('ENV', process.env); // Expose the process env
   * $.constant('time', Date.now.bind(Date)); // Expose a time() function
   */
  constant(constantName, constantValue) {
    debug('Registered a new constant:', constantName);
    return this.provider(constantName, Promise.resolve.bind(Promise, {
      servicePromise: Promise.resolve(constantValue),
      shutdownProvider: Promise.resolve.bind(Promise),
    }));
  }

  /**
   * Register a service
   * @param  {String}             serviceName        Service name
   * @param  {Function|Promise}   service            The service promise or a function returning it
   * @return {Function}                              The created service provider
   * @example
   *
   * import Knifecycle from 'sf-knifecycle'
   * import fs from 'fs';
   *
   * const $ = new Knifecycle();
   *
   * $.service('config', function config() {
   *   return new Promise((resolve, reject) {
   *     fs.readFile('config.js', function(err, data) {
   *       let config;
   *       if(err) {
   *         return reject(err);
   *       }
   *       try {
   *         config = JSON.parse(data.toString);
   *       } catch(err) {
   *         return reject(err);
   *       }
   *     resolve({
   *       service: config,
   *     });
   *   });
   * });
   */
  service(serviceName, service) {
    function serviceProvider() {
      return {
        servicePromise: 'function' === typeof service ?
        service() :
        service,
      };
    }
    this.provider(serviceName, serviceProvider);
    debug('Registered a new service:', serviceName);
    return serviceProvider;
  }

  /**
   * Register a service provider
   * @param  {String}     serviceName        Service name
   * @param  {Function}   serviceProvider    Service provider or a service provider promise
   * @return {Promise}                       The actual service descriptor promise
   * @example
   *
   * import Knifecycle from 'sf-knifecycle'
   * import fs from 'fs';
   *
   * const $ = new Knifecycle();
   *
   * $.provider('config', function configProvider() {
   *   return Promise.resolve({
   *     servicePromise: new Promise((resolve, reject) {
   *       fs.readFile('config.js', function(err, data) {
   *         let config;
   *         if(err) {
   *           return reject(err);
   *         }
   *         try {
   *           config = JSON.parse(data.toString);
   *         } catch(err) {
   *           return reject(err);
   *         }
   *   			 resolve({
   *   			   service: config,
   *   			 });
   *       });
   *     });
   *   });
   * });
   */
  provider(serviceName, serviceProvider) {
    const uniqueServiceProvider = serviceProvider.bind();

    uniqueServiceProvider[DEPENDENCIES] = serviceProvider[DEPENDENCIES] || [];

    uniqueServiceProvider[DEPENDENCIES].forEach((dependencyName) => {
      var dependencyProvider = this._servicesProviders.get(dependencyName);

      if(dependencyProvider && -1 !== dependencyProvider[DEPENDENCIES].indexOf(serviceName)) {
        throw new YError(E_CIRCULAR_DEPENDENCY, dependencyName, serviceName);
      }
    });

    this._servicesProviders.set(serviceName, uniqueServiceProvider);
    debug('Registered a new service provider:', serviceName);
    return uniqueServiceProvider;
  }

  /**
   * Decorator to claim that a service depends on others ones.
   * @param  {String[]}  dependenciesNames   Dependencies the decorated service provider depends on.
   * @param  {Function}  serviceProvider     Service provider or a service provider promise
   * @return {Function}                      Returns the decorator function
   * @example
   *
   * import Knifecycle from 'knifecycle'
   * import fs from 'fs';
   *
   * const $ = new Knifecycle();
   *
   * \@$.depends(['ENV'])
   * $.service('config', function configProvider({ ENV }) {
   *   return new Promise((resolve, reject) {
   *     fs.readFile(ENV.CONFIG_FILE, function(err, data) {
   *       let config;
   *       if(err) {
   *         return reject(err);
   *       }
   *       try {
   *         config = JSON.parse(data.toString);
   *       } catch(err) {
   *         return reject(err);
   *       }
   * 			 resolve({
   * 			   service: config,
   * 			 });
   *     });
   *   });
   * });
   */
  depends(dependenciesNames, serviceProvider) {
    const uniqueServiceProvider = serviceProvider.bind();

    uniqueServiceProvider[DEPENDENCIES] = (
      serviceProvider[DEPENDENCIES] ||
      []
    ).concat(dependenciesNames);

    debug('Wrapped a service provider with dependencies:', dependenciesNames);

    return uniqueServiceProvider;
  }

  /**
   * Creates a new execution silo
   * @param  {String[]}   dependenciesNames    Service name.
   * @return {Promise}                         Service descriptor promise.
   */
  run(dependenciesNames) {
    const siloContext = {
      servicesDescriptors: new Map(),
      servicesSequence: [],
    };

    // Create a provider for the shutdown special dependency
    siloContext.servicesDescriptors.set(SHUTDOWN, {
      servicePromise: Promise.resolve(() => {
        const shutdownPromise = _shutdownNextServices(siloContext.servicesSequence.reverse());

        debug('Shutting down services');

        return shutdownPromise;

        // Shutdown services in the reverse instanciation order
        function _shutdownNextServices(reversedServiceSequence) {
          if(0 === reversedServiceSequence.length) {
            return Promise.resolve();
          }
          return Promise.all(
            reversedServiceSequence.pop().map((serviceName) => {
              const serviceDescriptor = siloContext.servicesDescriptors.get(serviceName);

              debug('Shutting down a service:', serviceName);
              return serviceDescriptor.shutdownProvider ?
                serviceDescriptor.shutdownProvider() :
                Promise.resolve();
            })
          )
          .then(_shutdownNextServices.bind(null, reversedServiceSequence));
        }
      }),
      shutdownProvider: Promise.resolve.bind(Promise),
    });

    return this._initializeDependencies(siloContext, 'silo', dependenciesNames);
  }

  /**
   * Initialize or return a service descriptor
   * @param  {Object}     siloContext       Current execution silo context
   * @param  {String}     serviceName       Service name.
   * @param  {String}     serviceProvider   Service provider.
   * @return {Promise}                      Service dependencies hash promise.
   */
  _getServiceDescriptor(siloContext, serviceName) {
    const serviceDescriptor = siloContext.servicesDescriptors.get(serviceName);

    if(serviceDescriptor) {
      return Promise.resolve(serviceDescriptor);
    }

    return this._initializeServiceDescriptor(siloContext, serviceName);
  }

  /**
   * Initialize a service
   * @param  {Object}     siloContext       Current execution silo context
   * @param  {String}     serviceName       Service name.
   * @param  {String}     serviceProvider   Service provider.
   * @return {Promise}                      Service dependencies hash promise.
   */
  _initializeServiceDescriptor(siloContext, serviceName) {
    const serviceProvider = this._servicesProviders.get(serviceName);
    let serviceDescriptorPromise;

    debug('Initializing a service descriptor:', serviceName);

    if(!serviceProvider) {
      debug('No service provider:', serviceName);
      serviceDescriptorPromise = Promise.reject(new YError(E_UNMATCHED_DEPENDENCY, serviceName));
      siloContext.servicesDescriptors.set(serviceName, serviceDescriptorPromise);
      return serviceDescriptorPromise;
    }

    serviceDescriptorPromise = this._initializeDependencies(
      siloContext,
      serviceName,
      serviceProvider[DEPENDENCIES]
    )
    .then((deps) => {
      debug('Successfully initialized service dependencies:', serviceName);
      return deps;
    })
    .then(serviceProvider)
    .then((servicesDescriptor) => {
      debug('Successfully initialized a service descriptor:', serviceName);
      return servicesDescriptor;
    })
    .catch((err) => {
      debug('Error initializing a service descriptor:', serviceName, err.stack);
      if(E_UNMATCHED_DEPENDENCY === err.code) {
        throw YError.wrap.apply(YError, [
          err, E_UNMATCHED_DEPENDENCY, serviceName,
        ].concat(err.params)
        );
      }
      throw err;
    });
    siloContext.servicesDescriptors.set(serviceName, serviceDescriptorPromise);
    return serviceDescriptorPromise;
  }

  /**
   * Initialize a service dependencies
   * @param  {Object}     siloContext       Current execution silo siloContext
   * @param  {String}     serviceName       Service name.
   * @param  {String}     servicesNames     Dependencies names.
   * @return {Promise}                      Service dependencies hash promise.
   */
  _initializeDependencies(siloContext, serviceName, servicesNames) {
    debug('Initializing dependencies:', serviceName, servicesNames);
    return Promise.resolve()
    .then(() => {
      return Promise.all(
        servicesNames.map(this._getServiceDescriptor.bind(this, siloContext))
      )
      .then((servicesDescriptors) => {
        debug('Initialized dependencies descriptors:', serviceName, servicesNames);
        siloContext.servicesSequence.push(servicesNames);
        return Promise.all(servicesDescriptors.map((serviceDescriptor) => {
          return serviceDescriptor.servicePromise
            .then((service) => service);
        }));
      })
      .then((services) => {
        return services.reduce((hash, service, index) => {
          hash[servicesNames[index]] = service;
          return hash;
        }, {});
      });
    });
  }
}
