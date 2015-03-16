'use strict';

var assert = require('assert');
var async = require('async');
var juggler = require('loopback-datasource-juggler');
var loopback = require('loopback');
var stormpath = require('stormpath');
var uuid = require('uuid');

// The test suite's configuration details.  These are all pulled from locally
// set environment variables.  If you want to run this test suite yourself,
// you'll need to set the following environment variables to valid Stormpath
// credentials:
//
//  - STORMPATH_API_KEY_ID
//  - STORMPATH_API_KEY_SECRET
//  - STORMPATH_APPLICATION_HREF
var config = {
  apiKeyId: process.env.STORMPATH_API_KEY_ID,
  apiKeySecret: process.env.STORMPATH_API_KEY_SECRET,
};

// The global `Loopback` application object that we'll use to run our tests
// against.
var app = loopback();

// The global `User` object that we'll use to run our tests against.  Since this
// is just the connector library, and doesn't ship with a User model, this is
// essentially what we have to work with this library for testing purposes.
var User;

/**
 * Create a new Stormpath Client object.
 *
 * @returns {Object} A new Stormpath Client object.
 */
function createClient() {
  var apiKey = new stormpath.ApiKey(config.apiKeyId, config.apiKeySecret);
  return new stormpath.Client({ apiKey: apiKey });
}

/**
 * Create a new Stormpath Application along with a mapped Directory.
 *
 * This is used so that we get a brand new Stormpath Application with each test,
 * which is cleaned up automatically after each test call.  This ensures a
 * 'fresh' environment for testing.
 *
 * @param {Function} callback The callback function.
 */
function createApplication(client, callback) {
  var application = { name: uuid.v4() };
  var applicationOptions = { createDirectory: true };

  client.createApplication(application, applicationOptions, function(err, application) {
    if (err) return callback(err);
    callback(null, application);
  });
}

/**
 * Initializes our Stormpath DataSource, returning a new instance for us to use
 * later on.
 *
 * @param {Object} config The required DataSource configuration object.
 * @returns {Object} The new DataSource object.
 */
function getDataSource(config) {
  return new juggler.DataSource(require('..'), config);
}

/**
 * Initialize our global `User` object.
 *
 * This creates our User object, and binds our Data Source to the model so we
 * can start running tests!
 */
function createUserModel(dataSource) {
  User = app.loopback.User = app.loopback.createModel({
    name: 'User',
    options: {
      base: 'PersistedModel',
      idInjection: false,
      strict: false
    }
  });

  loopback.configureModel(User, { dataSource: dataSource });
}

describe('Stormpath', function() {

  var client;
  var application;

  // Bootstrap our test suite.  This is run only once, and handles basic setup:
  // creating a Stormpath Application, etc.
  before(function(done) {
    if (!config.apiKeyId || !config.apiKeySecret) {
      return done(new Error('No STORMPATH_API_KEY_ID and / or STORMPATH_API_KEY_SECRET environment variables set!'));
    }

    async.series([
      function(callback) {
        client = createClient();
        callback();
      },
      function(callback) {
        createApplication(client, function(err, app) {
          if (err) return callback(err);

          application = app;
          config.applicationHref = app.href;
          callback();
        });
      },
      function(callback) {
        createUserModel(getDataSource(config));
        callback();
      }
    ], function(err) {
      if (err) return done(err);
      done();
    });
  });

  // Tear down our test suite.  This is run only once after all tests have
  // finished.  It'll destroy our created resources, etc.
  after(function(done) {
    async.waterfall([

      // First, we'll iterate through each of our Account Store Mappings.
      function(callback) {
        application.getAccountStoreMappings(function(err, accountStoreMappings) {
          if (err) return callback(err);

          var mappings = [];

          accountStoreMappings.each(function(accountStoreMapping, cb) {
            mappings.push(accountStoreMapping);
            cb();
          }, function(err) {
            if (err) return callback(err);
            callback(null, mappings);
          });
        });
      },

      // Next, we'll iterate through all Account Store Mappings and remove the
      // linked Account Stores.
      function(mappings, callback) {
        async.each(mappings,
          function(mapping, cb) {
            mapping.getAccountStore(function(err, accountStore) {
              if (err) return cb(err);

              accountStore.delete(function(err) {
                if (err) return cb(err);
                cb();
              });
            });
          },
          function(err) {
            if (err) return callback(err);
            callback(null, mappings);
          }
        );
      },

      // Next, we'll iterate over the Account Store Mappings themselves,
      // removing them.
      function(mappings, callback) {
        async.each(mappings,
          function(mapping, cb) {
            mapping.delete(function(err) {
              if (err) return cb(err);
              cb();
            });
          },
          function(err) {
            if (err) return callback(err);
            callback();
          }
        );
      },

      // Finally, delete our Application.
      function(callback) {
        application.delete(function(err) {
          if (err) return callback(err);
          callback();
        });
      }
    ], function(err) {
      if (err) return done(err);
      done();
    });
  })

  describe('#create', function() {
    it('should create a user account given a givenName, surname, email and password', function(done) {
      var user = {
        givenName: 'Randall',
        surname: 'Degges',
        email: 'randall@stormpath.com',
        password: 'woot!ILOVEc00kies'
      };

      User.create(user, function(err, obj) {
        if (err) return done(err);
        done();
      });
    });
  })
});
