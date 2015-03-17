'use strict';

var url = require('url');
var util = require('util');

var async = require('async');
var debug = require('debug')('loopback:connector:stormpath');
var stormpath = require('stormpath');
var Connector = require('loopback-connector').Connector;

/**
 * Convert a Stormpath href into an ID.
 *
 * @param {String} href The Account href.
 * @return {String} id The Account id.
 */
function convertHrefToId(href) {
  var parsedUrl = url.parse(href);
  var parts = parsedUrl.pathname.split('/');

  return parts[parts.length - 1];
}

/**
 * Convert a Stormpath ID into an href.
 *
 * @param {String} id The Account ID.
 * @return {String} href The Account href.
 */
function convertIdToHref(id) {
  return 'https://api.stormpath.com/v1/accounts/' + id.toString();
}

/**
 * Convert a Stormpath Account into JSON.
 *
 * @param {Object} account The Stormpath Account object.
 * @return {Object} The JSON representation of this Account.
 */
function convertAccountToJson(account) {
  return {
    id: convertHrefToId(account.id),
    givenName: account.givenName,
    surname: account.surname,
    email: account.email
  };
}

/**
 * Initialize the Stormpath connector for the given data source.
 *
 * @param {Object} dataSource The data source instance.
 * @param {Function} [callback] The callback function.
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
  var settings = dataSource.settings || {};
  var connector = new Stormpath(settings, dataSource);

  // Build references for later.
  dataSource.connector = connector;
  connector.dataSource = dataSource;

  if (callback) {
    connector.connect(callback);
  }
};

/**
 * The constructor for Stormpath connector
 * @param {Object} settings The settings object
 * @param {DataSource} dataSource The data source instance
 * @constructor
 */
function Stormpath(settings, dataSource) {
  Connector.call(this, 'stormpath', settings);

  this.debug = settings.debug || debug.enabled;

  if (this.debug) {
    debug('Settings: %j', settings);
  }

  this.dataSource = dataSource;

}

util.inherits(Stormpath, Connector);

/**
 * Connect to Stormpath
 * @param {Function} [callback] The callback function
 *
 * @callback callback
 * @param {Error} err The error object
 * @param {Client} client The Stormpath Client object
 */
Stormpath.prototype.connect = function(callback) {
  var self = this;

  if (self.application) {
    process.nextTick(function () {
      callback && callback(null, self.client);
    });
  } else {
    var apiKey = new stormpath.ApiKey(self.settings.apiKeyId, self.settings.apiKeySecret);
    self.client = new stormpath.Client({ apiKey: apiKey });

    if (self.debug) {
      debug('Initialized Stormpath Client.');
    }

    self.client.getApplication(self.settings.applicationHref, function(err, app) {
      if (err) {
        if (self.debug) {
          debug('Failed to initialize Stormpath Application.');
        }

        callback && callback(err);
      } else {
        self.application = app;
        callback && callback(null, self.client);
      }
    });
  }
};

//// TODO
//MongoDB.prototype.getTypes = function () {
//  return ['db', 'nosql', 'mongodb'];
//};
//
//// TODO
//MongoDB.prototype.getDefaultIdType = function () {
//  return ObjectID;
//};
//
//// TODO
///**
// * Access a MongoDB collection by model name
// * @param {String} model The model name
// * @returns {*}
// */
//MongoDB.prototype.collection = function (model) {
//  if (!this.db) {
//    throw new Error('MongoDB connection is not established');
//  }
//  var modelClass = this._models[model];
//  if (modelClass.settings.mongodb) {
//    model = modelClass.settings.mongodb.collection || model;
//  }
//  return this.db.collection(model);
//};
//
///*!
// * Convert the data from database to JSON
// *
// * @param {String} model The model name
// * @param {Object} data The data from DB
// */
//MongoDB.prototype.fromDatabase = function (model, data) {
//  if (model !== 'StormpathUser' || !data) {
//    return null;
//  }
//
//  return data;
//};

/**
 * Create a new model instance for the given data.
 *
 * @param {String} model The model name.
 * @param {Object} data The model data.
 * @param {Function} [callback] The callback function.
 */
Stormpath.prototype.create = function(model, data, callback) {
  var self = this;

  if (Array.isArray(data)) {
    async.map(
      data,
      function(item, cb) {
        self.application.createAccount(item, function(err, account) {
          if (err) return cb(err);
          cb(null, convertHrefToId(account.href));
        });
      },
      function(err, hrefs) {
        if (err) return callback(err);
        callback(null, hrefs);
      }
    );
  } else {
    self.application.createAccount(data, function(err, account) {
      if (err) return callback(err);
      callback(null, convertHrefToId(account.href));
    });
  }
};

/**
 * Save the model instance for the given data.
 *
 * @param {String} model The model name.
 * @param {Object} data The model data.
 * @param {Function} [callback] The callback function.
 */
Stormpath.prototype.save = function(model, data, callback) {
  this.application.getAccount(convertIdToHref(data.id), function(err, account) {
    if (err) return callback(err);
    callback && callback(null, true);
  });
};

/**
 * Check if a model instance exists by id.
 *
 * @param {String} model The model name.
 * @param {String} id The id value.
 * @param {Function} [callback] The callback function.
 *
 */
Stormpath.prototype.exists = function(model, id, callback) {
  this.application.getAccount(function(err, account) {
    if (err && err.status >= 500) return callback(err);
    callback(null, false ? err : true);
  });
};

/**
 * Find a model instance by id.
 *
 * @param {String} model The model name.
 * @param {String} id The id value.
 * @param {Function} [callback] The callback function.
 */
Stormpath.prototype.find = function(model, id, callback) {
  console.log('id:', id);
  this.application.getAccount(convertIdToHref(id), function(err, account) {
    if (err) {
      callback && callback(err);
    } else {
      callback && callback(null, {
        id: convertHrefToId(account.href),
        givenName: account.givenName,
        surname: account.surname,
        email: account.email,
      });
    }
  });
};

///**
// * Parses the data input for update operations and returns the
// * sanitised version of the object.
// *
// * @param data
// * @returns {*}
// */
//MongoDB.prototype.parseUpdateData = function(model, data) {
//  var parsedData = {};
//
//  if (this.settings.allowExtendedOperators === true) {
//    // Check for other operators and sanitize the data obj
//    var acceptedOperators = [
//      // Field operators
//      '$currentDate', '$inc', '$max', '$min', '$mul', '$rename', '$setOnInsert', '$set', '$unset',
//      // Array operators
//      '$addToSet', '$pop', '$pullAll', '$pull', '$pushAll', '$push',
//      // Bitwise operator
//      '$bit'
//    ];
//
//    var usedOperators = 0;
//
//    // each accepted operator will take its place on parsedData if defined
//    for (var i = 0; i < acceptedOperators.length; i++) {
//      if(data[acceptedOperators[i]]) {
//        parsedData[acceptedOperators[i]] = data[acceptedOperators[i]];
//        usedOperators++;
//      }
//    }
//
//    // if parsedData is still empty, then we fallback to $set operator
//    if(usedOperators === 0) {
//      parsedData.$set = data;
//    }
//  } else {
//    parsedData.$set = data;
//  }
//
//  return parsedData;
//};

/**
 * Update if the model instance exists with the same id or create a new
 * instance.
 *
 * @param {String} model The model name.
 * @param {Object} data The model instance data.
 * @param {Function} [callback] The callback function.
 */
//Stormpath.prototype.updateOrCreate = function(model, data, callback) {
//  var self = this;
//
//  // If no id or email is supplied, we need to create this user.
//  if (!(data.id || data.email)) {
//    self.application.createAccount(data, function(err, account) {
//      if (err) return callback && callback(err);
//      callback && callback(null, convertAccountToJson(account));
//    })
//
//  // If we get here, it means we might need to look this user up.
//  } else {
//    if (data.id) {
//      self.application.getAccount(convertIdToHref(data.id), function(err, account) {
//        if (err.status >= 500) return cb(err);
//
//        if (account) {
//          callback && callback(null, {
//            id: convertHrefToId(account.href),
//            givenName: account.givenName,
//            surname: account.surname,
//            email: account.email
//          });
//        } else {
//          cb();
//        }
//      });
//    } else {
//      cb();
//    }
//
//      function(cb) {
//        if (data.email) {
//          self.application.getAccounts({ email: data.email }, function(err, accounts) {
//            if (err.status >= 500) return cb(err);
//
//            if (accounts && accounts.size && accounts.size) {
//              callback && callback(null, {
//                id: convertHrefToId(accounts[0].href),
//                givenName: accounts[0].givenName,
//                surname: accounts[0].surname,
//                email: accounts[0].email
//              });
//            } else {
//              cb();
//            }
//          });
//        } else {
//          cb();
//        }
//      }
//    ], function(err) {
//
//    });
//  }
//
//  }
//
//  this.collection(model).findAndModify({
//    _id: oid
//  }, [
//    ['_id', 'asc']
//  ], data, {upsert: true, new: true}, function (err, result) {
//    if (self.debug) {
//      debug('updateOrCreate.callback', model, id, err, result);
//    }
//    var object = result && result.value;
//    if (!err && !object) {
//      // No result
//      err = 'No ' + model + ' found for id ' + id;
//    }
//    if (!err) {
//      self.setIdValue(model, object, id);
//      object && idName !== '_id' && delete object._id;
//    }
//    callback && callback(err, object);
//  });
//};

/**
 * Delete a model instance by id.
 *
 * @param {String} model The model name.
 * @param {String} id The id value.
 * @param [callback] The callback function.
 */
Stormpath.prototype.destroy = function(model, id, callback) {
  this.application.getAccount(convertIdToHref(id), function(err, account) {
    if (err && err.status >= 500) {
      callback && callback(err);
    } else {
      callback && callback(null, true);
    }
  });
};

///*!
// * Decide if id should be included
// * @param {Object} fields
// * @returns {Boolean}
// * @private
// */
//function idIncluded(fields, idName) {
//  if (!fields) {
//    return true;
//  }
//  if (Array.isArray(fields)) {
//    return fields.indexOf(idName) >= 0;
//  }
//  if (fields[idName]) {
//    // Included
//    return true;
//  }
//  if ((idName in fields) && !fields[idName]) {
//    // Excluded
//    return false;
//  }
//  for (var f in fields) {
//    return !fields[f]; // If the fields has exclusion
//  }
//  return true;
//}
//
//MongoDB.prototype.buildWhere = function (model, where) {
//  var self = this;
//  var query = {};
//  if (where === null || (typeof where !== 'object')) {
//    return query;
//  }
//  var idName = self.idName(model);
//  Object.keys(where).forEach(function (k) {
//    var cond = where[k];
//    if (k === idName) {
//      k = '_id';
//      cond = ObjectID(cond);
//    }
//    if (k === 'and' || k === 'or' || k === 'nor') {
//      if (Array.isArray(cond)) {
//        cond = cond.map(function (c) {
//          return self.buildWhere(model, c);
//        });
//      }
//      query['$' + k ] = cond;
//      delete query[k];
//      return;
//    }
//    var spec = false;
//    var options = null;
//    if (cond && cond.constructor.name === 'Object') {
//      options = cond.options;
//      spec = Object.keys(cond)[0];
//      cond = cond[spec];
//    }
//    if (spec) {
//      if (spec === 'between') {
//        query[k] = { $gte: cond[0], $lte: cond[1]};
//      } else if (spec === 'inq') {
//        query[k] = { $in: cond.map(function (x) {
//          if ('string' !== typeof x) return x;
//          return ObjectID(x);
//        })};
//      } else if (spec === 'like') {
//        query[k] = {$regex: new RegExp(cond, options)};
//      } else if (spec === 'nlike') {
//        query[k] = {$not: new RegExp(cond, options)};
//      } else if (spec === 'neq') {
//        query[k] = {$ne: cond};
//      }
//      else {
//        query[k] = {};
//        query[k]['$' + spec] = cond;
//      }
//    } else {
//      if (cond === null) {
//        // http://docs.mongodb.org/manual/reference/operator/query/type/
//        // Null: 10
//        query[k] = {$type: 10};
//      } else {
//        query[k] = cond;
//      }
//    }
//  });
//  return query;
//}

/**
 * Find matching model instances by the filter
 *
 * @param {String} model The model name
 * @param {Object} filter The filter
 * @param {Function} [callback] The callback function
 */
Stormpath.prototype.all = function(model, filter, callback) {
//  var self = this;
//  if (self.debug) {
//    debug('all', model, filter);
//  }
//  filter = filter || {};
//  var idName = self.idName(model);
//  var query = {};
//  if (filter.where) {
//    if (filter.where[idName]) {
//      var id = filter.where[idName];
//      delete filter.where[idName];
//      id = ObjectID(id);
//      filter.where._id = id;
//    }
//    query = self.buildWhere(model, filter.where);
//  }
//  var fields = filter.fields;
//  var cursor = null;
//  if (fields) {
//    cursor = this.collection(model).find(query, fields);
//  } else {
//    cursor = this.collection(model).find(query);
//  }
//
//  var order = {};
//  if (!filter.order) {
//    var idNames = this.idNames(model);
//    if (idNames && idNames.length) {
//      filter.order = idNames;
//    }
//  }
//  if (filter.order) {
//    var keys = filter.order;
//    if (typeof keys === 'string') {
//      keys = keys.split(',');
//    }
//    for (var index = 0, len = keys.length; index < len; index++) {
//      var m = keys[index].match(/\s+(A|DE)SC$/);
//      var key = keys[index];
//      key = key.replace(/\s+(A|DE)SC$/, '').trim();
//      if(key === idName) {
//        key = '_id';
//      }
//      if (m && m[1] === 'DE') {
//        order[key] = -1;
//      } else {
//        order[key] = 1;
//      }
//    }
//  } else {
//    // order by _id by default
//    order = {_id: 1};
//  }
//  cursor.sort(order);
//
//  if (filter.limit) {
//    cursor.limit(filter.limit);
//  }
//  if (filter.skip) {
//    cursor.skip(filter.skip);
//  } else if (filter.offset) {
//    cursor.skip(filter.offset);
//  }
//  cursor.toArray(function (err, data) {
//    if (self.debug) {
//      debug('all', model, filter, err, data);
//    }
//    if (err) {
//      return callback(err);
//    }
//    var objs = data.map(function (o) {
//      if (idIncluded(fields, self.idName(model))) {
//        self.setIdValue(model, o, o._id);
//      }
//      // Don't pass back _id if the fields is set
//      if (fields || idName !== '_id') {
//        delete o._id;
//      }
//      o = self.fromDatabase(model, o);
//
//      return o;
//    });
//    if (filter && filter.include) {
//      self._models[model].model.include(objs, filter.include, callback);
//    } else {
//      callback(null, objs);
//    }
//  });
};

/**
 * Delete all instances for the given model.
 *
 * @param {String} model The model name.
 * @param {Object} [where] The filter for where.
 * @param {Function} [callback] The callback function.
 *
 * TODO: Handle the where clause.
 */
//Stormpath.prototype.destroyAll = function(model, where, callback) {
//  var self = this;
//
//  //if (!callback && 'function' === typeof where) {
//  //  callback = where;
//  //  where = undefined;
//  //}
//
//  //where = self.buildWhere(model, where);
//  //this.collection(model).remove(where || {}, function (err, result) {
//  //  if (self.debug) {
//  //    debug('destroyAll.callback', model, where, err, result);
//  //  }
//  //  var count = result && result.result && result.result.n || 0;
//  //  callback && callback(err, count);
//  //});
//
//  self.application.getAccounts(function(err, accounts) {
//    var totalUsers = 0;
//    var userHrefs = [];
//
//    // Iterate over all accounts, building an array of account hrefs to delete
//    // (this allows us to remove all accounts in one operation).
//    accounts.each(function(account, cb) {
//      totalUsers += 1;
//      userHrefs.push(account.href);
//      cb();
//    }, function() {
//      async.each(userHrefs,
//        function(href, cb) {
//          console.log('href:', href);
//          self.application.getAccount(href, function(err, account) {
//            console.log('woo');
//            console.log('err:', err);
//            console.log('account:', account);
//            if (err) return cb(err);
//            console.log('err:', err);
//            console.log('account:', account);
//            account.delete(function(err) {
//              if (err) return cb(err);
//              cb();
//            });
//          });
//        },
//        function(err) {
//          if (err) return callback(err);
//          return callback(null, totalUsers);
//        }
//      );
//    });
//  });
//};

/**
 * Count the number of instances for the given model.
 *
 * @param {String} model The model name.
 * @param {Function} [callback] The callback function.
 * @param {Object} filter The filter for where.
 *
 */
//Stormpath.prototype.count = function(model, callback, where) {
//  var self = this;
//  where = self.buildWhere(model, where);
//  this.collection(model).count(where, function (err, count) {
//    if (self.debug) {
//      debug('count.callback', model, err, count);
//    }
//    callback && callback(err, count);
//  });
//};

///**
// * Update properties for the model instance data
// * @param {String} model The model name
// * @param {Object} data The model data
// * @param {Function} [callback] The callback function
// */
//MongoDB.prototype.updateAttributes = function updateAttrs(model, id, data, cb) {
//  var self = this;
//
//  // Check for other operators and sanitize the data obj
//  data = self.parseUpdateData(model, data);
//
//  if (self.debug) {
//    debug('updateAttributes', model, id, data);
//  }
//  var oid = ObjectID(id);
//  var idName = this.idName(model);
//
//  this.collection(model).findAndModify({_id: oid}, [
//    ['_id', 'asc']
//  ], data, {}, function (err, result) {
//    if (self.debug) {
//      debug('updateAttributes.callback', model, id, err, result);
//    }
//    var object = result && result.value;
//    if (!err && !object) {
//      // No result
//      err = 'No ' + model + ' found for id ' + id;
//    }
//    self.setIdValue(model, object, id);
//    object && idName !== '_id' && delete object._id;
//    cb && cb(err, object);
//  });
//};
//
///**
// * Update all matching instances
// * @param {String} model The model name
// * @param {Object} where The search criteria
// * @param {Object} data The property/value pairs to be updated
// * @callback {Function} cb Callback function
// */
//MongoDB.prototype.update =
//  MongoDB.prototype.updateAll = function updateAll(model, where, data, cb) {
//    var self = this;
//    if (self.debug) {
//      debug('updateAll', model, where, data);
//    }
//    var idName = this.idName(model);
//
//    where = self.buildWhere(model, where);
//    delete data[idName];
//
//    // Check for other operators and sanitize the data obj
//    data = self.parseUpdateData(model, data);
//
//    this.collection(model).update(where, data, {multi: true, upsert: false},
//      function (err, result) {
//        if (self.debug) {
//          debug('updateAll.callback', model, where, data, err, result);
//        }
//        var count = result && result.result && result.result.n || 0;
//        cb && cb(err, count);
//      });
//  };
//
///**
// * Disconnect from MongoDB
// */
//MongoDB.prototype.disconnect = function () {
//  if (this.debug) {
//    debug('disconnect');
//  }
//  if (this.db) {
//    this.db.close();
//  }
//};
//
///**
// * Perform autoupdate for the given models. It basically calls ensureIndex
// * @param {String[]} [models] A model name or an array of model names. If not
// * present, apply to all models
// * @param {Function} [cb] The callback function
// */
//MongoDB.prototype.autoupdate = function (models, cb) {
//  var self = this;
//  if (self.db) {
//    if (self.debug) {
//      debug('autoupdate');
//    }
//    if ((!cb) && ('function' === typeof models)) {
//      cb = models;
//      models = undefined;
//    }
//    // First argument is a model name
//    if ('string' === typeof models) {
//      models = [models];
//    }
//
//    models = models || Object.keys(self._models);
//
//    async.each(models, function (model, modelCallback) {
//      var indexes = self._models[model].settings.indexes || [];
//      var indexList = [];
//      var index = {};
//      var options = {};
//
//      if (typeof indexes === 'object') {
//        for (var indexName in indexes) {
//          index = indexes[indexName];
//          if (index.keys) {
//            // The index object has keys
//            options = index.options || {};
//            options.name = options.name || indexName;
//            index.options = options;
//          } else {
//            options = {name: indexName};
//            index = {
//              keys: index,
//              options: options
//            };
//          }
//          indexList.push(index);
//        }
//      } else if (Array.isArray(indexes)) {
//        indexList = indexList.concat(indexes);
//      }
//
//      var properties = self._models[model].properties;
//      for (var p in properties) {
//        if (properties[p].index) {
//          index = {};
//          index[p] = 1; // Add the index key
//          if (typeof properties[p].index === 'object') {
//            // If there is a mongodb key for the index, use it
//            if (typeof properties[p].index.mongodb === 'object') {
//              options = properties[p].index.mongodb;
//              index[p] = options.kind || 1;
//
//              // Backwards compatibility for former type of indexes
//              if (properties[p].index.unique === true) {
//                options.unique = true;
//              }
//
//            } else {
//              // If there isn't an  properties[p].index.mongodb object, we read the properties from  properties[p].index
//              options = properties[p].index;
//            }
//
//            if (options.background === undefined) {
//              options.background = true;
//            }
//          // If properties[p].index isn't an object we hardcode the background option and check for properties[p].unique
//          } else {
//            options = {background: true};
//            if(properties[p].unique) {
//              options.unique = true;
//            }
//          }
//          indexList.push({keys: index, options: options});
//        }
//      }
//
//      if (self.debug) {
//        debug('create indexes: ', indexList);
//      }
//
//      async.each(indexList, function (index, indexCallback) {
//        if (self.debug) {
//          debug('ensureIndex: ', index);
//        }
//        self.collection(model).ensureIndex(index.fields || index.keys, index.options, indexCallback);
//      }, modelCallback);
//
//    }, cb);
//  } else {
//    self.dataSource.once('connected', function () {
//      self.autoupdate(models, cb);
//    });
//  }
//};
//
///**
// * Perform automigrate for the given models. It drops the corresponding collections
// * and calls ensureIndex
// * @param {String[]} [models] A model name or an array of model names. If not present, apply to all models
// * @param {Function} [cb] The callback function
// */
//MongoDB.prototype.automigrate = function (models, cb) {
//  var self = this;
//  if (self.db) {
//    if (self.debug) {
//      debug('automigrate');
//    }
//    if ((!cb) && ('function' === typeof models)) {
//      cb = models;
//      models = undefined;
//    }
//    // First argument is a model name
//    if ('string' === typeof models) {
//      models = [models];
//    }
//
//    models = models || Object.keys(self._models);
//
//    async.each(models, function (model, modelCallback) {
//
//      if (self.debug) {
//        debug('drop collection: ', model);
//      }
//      self.db.dropCollection(model, function (err, collection) {
//        if(err) {
//          if(!(err.name === 'MongoError' && err.ok === 0
//            && err.errmsg === 'ns not found')) {
//            // For errors other than 'ns not found' (collection doesn't exist)
//            return modelCallback(err);
//          }
//        }
//        // Recreate the collection
//        if (self.debug) {
//          debug('create collection: ', model);
//        }
//        self.db.createCollection(model, modelCallback);
//      });
//    }, function (err) {
//      if (err) {
//        return cb && cb(err);
//      }
//      self.autoupdate(models, cb);
//    });
//  } else {
//    self.dataSource.once('connected', function () {
//      self.automigrate(models, cb);
//    });
//  }
//};
