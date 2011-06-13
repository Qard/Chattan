#!/usr/local/bin/node
// Load required modules.
var express = require('express')
	, events = require('events')
	, socket = require('./socket-server')
	, upload = require('./upload')
	, cradle = require('cradle')
	, crypto = require('crypto')
	, creds = require('./creds')
	, http = require('http')
	, file = require('fs')
	, s3 = require('knox');

var emitter = new events.EventEmitter;

var isLocal = ( ! process.env['DUOSTACK_APP_NAME']);

// Create generic MOTD.
var motd = 'For help with using CHATTAN!! type /help.';

// Keep list of loggedin users by name.
var loggedIn = [];
var anonLoggedIn = 0;

/************************
 *                      *
 *    Setup Database    *
 *                      *
 ************************/

// Create Cloudant CouchDB connection.
var couch = new(cradle.Connection)({
	host: 'chattan.cloudant.com'
	, port: 443
	, secure: true
	, cache: true
	, raw: false
	, auth: creds.cloudant
});

// Create database object.
var db = {
	users: couch.database('users')
	, feeds: couch.database('feeds')
	, subscriptions: couch.database('subscriptions')
	, blacklist: couch.database('blacklist')
};

// Create some views, if they don't exist already.
db.users.get('_design/users', function(err) {
	if (err) {
		db.users.save('_design/users', {
			all: {
				map: function (doc) {
					emit(doc._id, doc);
				}
			},
			loggedin: {
				map: function (doc) {
					if (doc.loggedin) {
						emit(doc._id, doc);
					}
				}
			}
		});
	}
});

// If default users were supplied,
// make sure they are in the database.
if (creds.users) {
	for (var i in creds.users) {
		db.users.get(i, function(err, doc) {
			// They don't exist yet, add them.
			if (err) {
				// Move name into doc structure.
				creds.users[i]._id = i;
				
				// Encrypt password.
				var cipher = crypto.createCipher(creds.crypto.mode, creds.crypto.key);
				var pass = cipher.update(creds.users[i].password, 'utf8', 'hex');
				pass += cipher.final('hex');
				
				// Update password to encrypted value.
				creds.users[i].password = pass;
				
				// Save to database.
				db.users.save(i, creds.users[i], function(err, res){
					if ( ! err) {
						delete creds.users[i];
					}
				});
			}
		});
	}
}

// Load blacklist into array. It probably won't eat too much memory.
// I'd rather load it now than make the users wait on connection.
var blacklist = [];
db.blacklist.all(function(err, res){
	if ( ! err) {
		for (var i in res) {
			blacklist.push(res[i].id);
		}
	}
});

// Get list of tracked feeds.
db.feeds.all(function(err, docs){
	if ( ! err) {
		for (var i = 0; i < docs.length; i++) {
			(function(feed){
				var parts = feed.key.split('/');
				var opts = {
					host: parts[0]
					, port: 80
					, path: '/'+parts.splice(1).join('/')
					, method: 'GET'
				};
				setInterval(function(){
					var req = http.request(opts, function(res){
						// Ignore failures and not-modifieds.
						if (res.statusCode >= 200 && res.statusCode < 300) {
							var content = '';
							res.setEncoding('utf8');
							res.on('data', function (chunk) {
								content += chunk;
							});
							res.on('close', function(){
								emitter.emit('subscriptionUpdate-'+feed.key, content);
							});
						}
					});
					req.end();
				}, 1000 * 60 * 5);
			})(docs[i]);
		}
	}
});

/************************
 *                      *
 *    Setup Express     *
 *                      *
 ************************/

// Create express server.
var app = express.createServer();

// Configure express to serve static files.
app.configure(function(){
	app.use(express.static(__dirname+'/static'));
});

// Attach upload system.
var app = upload.listen(app);

// Serve index.html from all URLs not already occupied by static content.
app.get('*', function(req, res){
	file.readFile('static/index.html', function(err, file) {
		if (err) throw err;
		
		res.header('Content-Length', file.length);
		res.contentType('text/html');
		res.send(file);
	});
});

// Start listening.
app.listen(8124);

// Attache socket server.
socket.listen(db, app);