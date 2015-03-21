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
 * Merge the given data into the given account.  This takes all customData
 * fields into account.
 *
 * NOTE: The account *MUST* have already expanded customData for this to work!
 *
 * @param {Object} account The Stormpath Account object.
 * @param {Object} data The Loopback User object containing newer account
 *  information.
 */
function updateAccount(account, data) {
  var standardFields = ['givenName', 'surname', 'middleName', 'email'];

  for (var i = 0; i < standardFields.length; i++) {
    account[standardFields[i]] = data[standardFields[i]] || account[standardFields[i]];
  }

  if (data.password) {
    account.password = data.password;
  }

  for (var key in data) {
    if (key !== 'password' && key !== 'id' && standardFields.indexOf(key) === -1) {
      account.customData[key] = data[key];
    }
  }
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
  this.client.getAccount(convertIdToHref(data.id), function(err, account) {
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
  this.client.getAccount(function(err, account) {
    if (err && err.status >= 500) return callback(err);
    callback(null, false ? err : true);
  });
};

/**
 * Find a model instance by ID.
 *
 * @param {String} model The model name.
 * @param {String} id The model ID.
 * @param {Function} [callback] The callback function.
 *
 * NOTE: This is actually called `User.findById()` when called by the user due
 * to some legacy Loopback code.
 */
Stormpath.prototype.find = function(model, id, callback) {
  this.client.getAccount(convertIdToHref(id), function(err, account) {
    if (err) return callback && callback(err);
    return callback && callback(null, convertAccountToJson(account));
  });
};

/**
 * Update if the model instance exists with the same id or create a new
 * instance.
 *
 * @param {String} model The model name.
 * @param {Object} data The model instance data.
 * @param {Function} [callback] The callback function.
 */
Stormpath.prototype.updateOrCreate = function(model, data, callback) {
  var self = this;

  // If no id or email is supplied, we need to create this user.
  if (!(data.id || data.email)) {
    self.application.createAccount(data, function(err, account) {
      if (err) return callback && callback(err);
      return callback && callback(null, convertAccountToJson(account));
    })
  }

  // If there is an id field present, it means this user already exists, so we
  // should attempt to look them up.
  if (data.id) {
    self.client.getAccount(convertIdToHref(data.id), { expand: 'customData' }, function(err, account) {
      if (err && err.status >= 500) return callback && callback(err);

      // If this account exists, then we'll merge in the new data and save our
      // changes.
      if (account) {
        updateAccount(account, data);

        // This merges in the ID field so we can comply with Loopback's
        // structured stuff.
        account.id = data.id;

        async.parallel([
          function(cb) {
            account.save(function(err) {
              cb(err || null);
            });
          },
          function(cb) {
            // This gets rid of all 'hidden' fields except the href.
            var customData = JSON.parse(JSON.stringify(account.customData));

            if (Object.keys(customData).length > 1) {
              account.customData.save(function(err) {
                cb(err || null);
              });
            } else {
              cb();
            }
          }
        ], function(err) {
          if (err) return callback && callback(err);
          return callback && callback(null, convertAccountToJson(account));
        });

      // If we get here, it means the account doesn't exist, so we'll create it.
      } else {
        self.application.createAccount(data, function(err, account) {
          if (err) return callback && callback(err);
          return callback && callback(null, convertAccountToJson(account));
        })
      }
    });

  // If there is an email field present, we should attempt to look this user up.
  } else if (data.email) {
    self.client.getAccounts(data.email.toLowerCase(), { expand: 'customData' }, function(err, accounts) {
      if (err && err.status >= 500) return callback(err);

      var account;

      accounts.each(function(acc, cb) {
        if (acc.email === data.email.toLowerCase()) {
          account = acc;
        }
        cb();
      }, function(err) {
        if (err) return callback(err);

        // If this account exists, then we'll merge in the new data and save our
        // changes.
        if (account) {
          updateAccount(account, data);

          async.parallel([
            function(cb) {
              account.save(function(err) {
                cb(err || null);
              });
            },
            function(cb) {
              account.customData.save(function(err) {
                cb(err || null);
              });
            }
          ], function(err) {
            if (err) return callback(err);
            return callback && callback(null, convertAccountToJson(account));
          });

        // If we get here, it means the account doesn't exist, so we'll create it.
        } else {
          self.application.createAccount(data, function(err, account) {
            if (err) return callback && callback(err);
            return callback && callback(null, convertAccountToJson(account));
          });
        }
      });
    });
  } else {
    return callback && callback(new Error('Oops! Something bad happened.'));
  }
};

/**
 * Build a query to be used with application.getAccounts(...);
 *
 * @param {Object} where The Loopback where object.
 * @returns {Object} query An appropriate Stormpath query.
 */
function buildWhere = function(where) {
  var query = {};

  if (where === null || (typeof where !== 'object')) {
    return query;
  }

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
}

/**
 * Find matching model instances by the filter
 *
 * @param {String} model The model name
 * @param {Object} filter The filter
 * @param {Function} [callback] The callback function
 */
Stormpath.prototype.all = function(model, filter, callback) {
  var self = this;

  if (!callback && typeof filter === 'function') {
    callback = filter;
    filter = {};
  }

  filter = filter || {};

  return callback && callback(null, []);

  if (filter.where) {
    query = buildWhere(filter.where);
  }

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
Stormpath.prototype.destroyAll = function(model, where, callback) {
  var self = this;

  // Allow the user to call this method without any where query specified.
  if (!callback && 'function' === typeof where) {
    callback = where;
    where = undefined;
  }

  //where = self.buildWhere(model, where);
  //this.collection(model).remove(where || {}, function (err, result) {
  //  if (self.debug) {
  //    debug('destroyAll.callback', model, where, err, result);
  //  }
  //  var count = result && result.result && result.result.n || 0;
  //  callback && callback(err, count);
  //});

  self.application.getAccounts(function(err, accounts) {
    var totalUsers = 0;
    var userHrefs = [];

    // Iterate over all accounts, building an array of account hrefs to delete
    // (this allows us to remove all accounts in one operation).
    accounts.each(function(account, cb) {
      totalUsers += 1;
      userHrefs.push(account.href);
      cb();
    }, function(err) {
      if (err) return callback(err);

      async.each(userHrefs,
        function(href, cb) {
          self.client.getAccount(href, function(err, account) {
            if (err) return cb(err);

            account.delete(function(err) {
              if (err) return cb(err);
              cb();
            });
          });
        },
        function(err) {
          if (err) return callback(err);
          return callback(null, totalUsers);
        }
      );
    });
  });
};

/**
 * Count the number of instances for the given model.
 *
 * @param {String} model The model name.
 * @param {Function} [callback] The callback function.
 * @param {Object} filter The filter for where.
 *
 */
Stormpath.prototype.count = function(model, callback, where) {
  // TODO: support where clause
  //var self = this;
  //where = self.buildWhere(model, where);
  //this.application.count(where, function (err, count) {
  //  if (self.debug) {
  //    debug('count.callback', model, err, count);
  //  }
  //  callback && callback(err, count);
  //});

  this.application.getAccounts(function(err, accounts) {
    if (err) return callback && callback(err);
    callback && callback(null, accounts.size);
  });
};

/**
 * Update all matching instances.
 *
 * @param {String} model The model name.
 * @param {Object} where The search criteria.
 * @param {Object} data The property/value pairs to be updated.
 * @callback {Function} cb Callback function.
 */
Stormpath.prototype.update = Stormpath.prototype.updateAll = function(model, where, data, cb) {
  var self = this;

  //var idName = this.idName(model);

  //where = self.buildWhere(model, where);
  //delete data[idName];

  //// Check for other operators and sanitize the data obj
  //data = self.parseUpdateData(model, data);

  //this.collection(model).update(where, data, {multi: true, upsert: false},
  //  function (err, result) {
  //    if (self.debug) {
  //      debug('updateAll.callback', model, where, data, err, result);
  //    }
  //    var count = result && result.result && result.result.n || 0;
  //    cb && cb(err, count);
  //  });
};
