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
  var user = {
    givenName: 'Randall',
    surname: 'Degges',
    email: 'randall@stormpath.com',
    password: 'woot!ILOVEc00kies'
  };

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

  // Remove all newly created Accounts after each test has been run.  This
  // ensures we don't get naming collisions.
  afterEach(function(done) {
    application.getAccounts(function(err, accounts) {
      if (err) return done(err);

      accounts.each(function(account, callback) {
        account.delete(function(err) {
          if (err) return callback(err);
          callback();
        });
      }, function(err) {
        if (err) return done(err);
        done();
      });
    });
  });

  describe('#create', function() {
    it('should create a user account given a givenName, surname, email and password', function(done) {
      User.create(user, function(err, obj) {
        if (err) return done(err);

        assert.equal(obj.givenName, user.givenName);
        assert.equal(obj.surname, user.surname);
        assert.equal(obj.email, user.email);
        done();
      });
    });

    it('should create multiple accounts if an array is passed', function(done) {
      var user2 = {
        givenName: 'Elon',
        surname: 'Musk',
        email: 'emusk@spacex.com',
        password: 'r0ck3tsRfuN!'
      };

      User.create([user, user2], function(err, objs) {
        if (err) return done(err);

        assert.equal(objs.length, 2);
        done();
      });
    });
  });

  describe('#save', function() {
    it('should save all modified attributes', function(done) {
      User.create(user, function(err, obj) {
        if (err) return done(err);

        obj.givenName = 'Woot';
        obj.surname = 'Woot';
        obj.email = 'woot@stormpath.com';

        obj.save(function(err, updatedUser) {
          if (err) return done(err);

          assert.equal(updatedUser.givenName, user.givenName);
          assert.equal(updatedUser.surname, user.surname);
          assert.equal(updatedUser.email, user.email);

          done();
        });
      })
    });

    it('should work on newly created objects', function(done) {
      var u = new User(user);

      u.save(function(err, persistedUser) {
        if (err) return done(err);

        assert.equal(persistedUser.givenName, u.givenName);
        assert.equal(persistedUser.surname, u.surname);
        assert.equal(persistedUser.email, u.email);

        done();
      });
    });
  });

  describe('#exists', function() {
    it('should return false if no user exists', function(done) {
      User.exists('abc123', function(err, exists) {
        if (err) return done(err);

        assert(!exists);
        done();
      });
    });

    it('should return true if the user exists', function(done) {
      User.create(user, function(err, obj) {
        if (err) return done(err);

        User.exists(obj.id, function(err, exists) {
          if (err) return done(err);

          assert(exists);
          done();
        });
      });
    });
  });

  describe('#find', function() {
  //  it('should return no users if no users exist', function(done) {
  //    User.find({}, function(err, objs) {
  //      assert.equal(objs.length, 0);
  //      done();
  //    });
  //  });

  //  it('should return users when users exist', function(done) {
  //    User.create(user, function(err, obj) {
  //      if (err) return done(err);

  //      User.find({}, function(err, users) {
  //        if (err) return done(err);

  //        assert.equal(users.length, 1);
  //        assert.equal(users[0].id === obj.id);
  //        done();
  //      });
  //    });
  //  });
  });

  describe('#updateOrCreate', function() {
    it('should successfully update an existing user', function(done) {
      User.create(user, function(err, obj) {
        if (err) return done(err);

        obj.email = 'john@gmail.com';

        User.updateOrCreate(obj, function(err, updatedUser) {
          if (err) return done(err);

          assert.equal(updatedUser.id, obj.id);
          assert.equal(updatedUser.email, obj.email);
          done();
        });
      });
    });

    it('should successfully create a new user', function(done) {
      var u = new User(user);

      User.updateOrCreate(u, function(err, updatedUser) {
        if (err) return done(err);

        assert(updatedUser.id);
        assert.equal(updatedUser.email, u.email);
        done();
      });
    });
  });

  describe('#count', function() {
    it('should return 0 if no accounts exist', function(done) {
      User.count({}, function(err, count) {
        if (err) return done(err);

        assert.equal(count, 0);
        done();
      });
    });

    it('should return the number of accounts that exist', function(done) {
      User.create(user, function(err, obj) {
        if (err) return done(err);

        User.count({}, function(err, count) {
          if (err) return done(err);

          assert.equal(count, 1);
          done();
        });
      });
    });
  });

  describe('#destroyAll', function() {
    it('should return 0 if no users were deleted', function(done) {
      User.destroyAll(function(err, deleted) {
        if (err) return done(err);

        assert.equal(deleted, 0);
        done();
      });
    });

    it('should return 1 if 1 user was deleted', function(done) {
      User.create(user, function(err, obj) {
        if (err) return done(err);

        User.destroyAll(function(err, deleted) {
          if (err) return done(err);

          assert.equal(deleted, 1);
          done();
        });
      });
    });
  });
});
