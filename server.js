#!/usr/local/bin/node
// Load required modules.
var express = require('express')
	, socket = require('socket.io')
	, cradle = require('cradle')
	, crypto = require('crypto')
	, creds = require('./creds')
	, file = require('fs');

// Create generic MOTD.
var motd = 'For help with using CHATTAN!! type /help.';

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

// Create database connections.
var db = {
	users: couch.database('users')
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
				db.users.save(i, creds.users[i], function(err){
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
	app.use(express.router);
});

// Serve index.html from all URLs not already occupied by static content.
app.get('*', function(req, res){
	res.sendHeader(200, {"Content-Type": "text/html"});
	file.readFile(__dirname+'/static/index.html', function(err, file) {
		if (err) throw err;
		res.send(file);
	});
});

// Start listening.
app.listen(8124);

/************************
 *                      *
 *    Helper Methods    *
 *                      *
 ************************/

// Give banned users the boot.
var isBanned = function(client) {
	if (client.connection && blacklist.indexOf(client.connection.remoteAddress) > -1){
		client.send('You have been banned!');
		delete client;
		return true;
	} else {
		return false;
	}
};

// Find Socket.IO client by _id.
var findClientByName = function(name) {
	for (var i in socket.clients) {
		if (socket.clients[i].user._id === name) {
			return socket.clients[i].user;
		}
	}
	return false;
};

// Find Socket.IO client by IP Address.
var findClientByIp = function(ip) {
	for (var i in socket.clients) {
		if (ip === socket.clients[i].connection.remoteAddress){
			return socket.clients[i];
		}
	}
	return false;
};

/************************
 *                      *
 *    Setup Socket.IO   *
 *                      *
 ************************/

// Wrap express server
var socket = socket.listen(app);

// Define connection event.
socket.on('connection', function(client){
	// Ignore banned users.
	if ( ! isBanned(client)) {
		// Make an Anonymous user object.
		client.user = {
			_id: 'Anonymous'
			, admin: false
			, loggedin: true
		};
		
		// Notify others when a user connects.
		client.broadcast(client.user._id+' has joined!');
		client.send('You have joined as '+client.user._id);
		
		// Send the MOTD, if set.
		if (motd){
			client.send('MOTD: '+motd);
		}
		
		// Pass messages to other users.
		client.on('message', function(msg){
			// Check for slash codes
			if (msg[0] == '/'){
				// Split message
				var parts = msg.split(' ');
				
				// Store code and message content.
				var code = parts[0];
				var message = parts.slice(1).join(' ');
				
				switch (code){
					/**
					 * Provide a list of helpful information for new users.
					 * 
					 * /help
					 */
					case '/help':
						// Generate available filter list.
						var filters = [
							'Video Services (YouTube, Vimeo, Google Video, Facebook, Myspace, etc.)'
							, 'Images'
							, 'PDFs'
							, 'MP4/OGG/WEBM Videos'
							, 'Magiccards.info Card Pages'
							, 'Google Maps Permalinks'
							, 'and of course regular, plain old URLs'
						];
						
						// Generate available command list.
						var list = [
							'<h4>User slashcodes:</h4>'
							, '/register username password - Register a named user account.'
							, '/login username password - Login to an existing named user account.'
							, '/me message - Speak in third person.'
							, '/motd - Repeat the Message of the Day.'
						];
						
						// Add admin commands to list, if user is an admin.
						if (client.user.admin) {
							list.push('');
							list.push('<h4>Admin slashcodes:</h4>');
							list.push('/motd message - Set the Message of the Day.');
							list.push('/promote username - Promote a user to admin status.');
							list.push('/banip ip - Ban a user by IP address.');
						}
						
						// Construct message.
						var msg = 'There are many text filters to convert URLs to embedded content, including:';
						msg += '<ul><li>'+filters.join('</li><li>')+'</li></ul>';
						msg += '<br />'+list.join('<br />');
						
						// Send message.
						client.send(msg);
						break;
					
					/**
					 * Register a new user account. Password is optional.
					 * 
					 * /register username password
					 */
					case '/register':
						var username = parts[1].toLowerCase();
						var password = parts[2];
						
						// Attempt to fetch the user from the database.
						db.users.get(username, function(err, doc) {
							// Make sure that name isn't already taken.
							if ( ! err) {
								client.send('That name is already taken.');
							
							// Otherwise, add user to user list.
							} else {
								// Get old username.
								var old_name = client.user._id;
								
								// Create temporary user object.
								var user = {};
								
								// Move name into doc structure.
								user._id = username;
								
								// Encrypt password.
								var cipher = crypto.createCipher(creds.crypto.mode, creds.crypto.key);
								var password = cipher.update(password,'utf8','hex');
								password += cipher.final('hex');
								
								// Update password to encrypted value.
								user.password = password;
								
								// Not an admin until promoted.
								user.admin = false;
								user.loggedin = true;
								
								// Save to database.
								db.users.save(parts[1], user, function(err, res){
									if (err) {
										client.send('Registration failed. Try again later.');
									} else {
										// Overwrite actual user data with temporary data.
										client.user = user;
										socket.broadcast(old_name+' is now '+user._id);
									}
								});
							}
						});
						break;
					
					/**
					 * Login using an existing user account.
					 * 
					 * /login username password
					 */
					case '/login':
						var username = parts[1].toLowerCase();
						var password = parts[2];
						
						// Attempt to fetch the user from the database.
						db.users.get(username, function(err, doc) {
							// Make sure named user exists.
							if (err) {
								client.send('That user does not exist.');
							
							// User exists, prepare to compare passwords.
							} else {
								// Encrypt password.
								var decipher = crypto.createDecipher(creds.crypto.mode, creds.crypto.key);
								var pass = decipher.update(doc.password,'utf8','hex');
								pass += decipher.final('hex');
								
								// Make sure password matches before logging in.
								if (password !== pass) {
									client.send('Incorrect password.');
								
								// Password matches.
								} else {
									// Set loggedin state.
									doc.loggedin = true;
									
									// We want to save loggedin state.
									db.users.save(username, doc, function(err) {
										if ( ! err) {
											client.user = doc;
											socket.broadcast(client.user._id+' has logged in.');
										}
									});
								}
							}
						});
						break;
					
					/**
					 * Speak in the third person.
					 * 
					 * /me is speaking in third person.
					 */
					case '/me':
						socket.broadcast(client.user._id+' '+message);
						break;
					
					/**
					 * Change the Message of the Day.
					 * 
					 * /motd This is the motd!
					 */
					case '/motd':
						// We are changing the MOTD, we need to verify admin status.
						if (client.user.admin && message) {
							motd = message;
							socket.broadcast('MOTD changed to: '+motd);
							
						// We are only reading the MOTD, just respond.
						} else {
							client.send('MOTD: '+motd);
						}
						break;
					
					/**
					 * Promote user to admin status.
					 * 
					 * /promote username
					 */
					case '/promote':
						if (client.user.admin){
							var username = parts[1].toLowerCase();
						
							// Attempt to fetch the user from the database.
							db.users.get(username, function(err, doc) {
								if ( ! err) {
									db.users.merge(username, { admin: true }, function(err, res){
										if (err) {
											client.send('No user by that name found.');
										} else {
											// Overwrite actual user data with temporary data.
											var user = findClientByName(username);
											user = doc;
											socket.broadcast(username+' has been promoted to Administrator.');
										}
									});
								}
							});
							
							// Only break the switch for admins.
							// Don't want users to know this slashcode exists.
							break;
						}
					
					/**
					 * Ban a user by IP address.
					 * 
					 * /banip ip
					 */
					case '/banip':
						if (client.user.admin) {
							// Add IP to blacklist.
							db.blacklist.save(parts[1], { reason: parts[2] || 'Unspecified' }, function(err, doc){
								if ( ! err) {
									blacklist.push(doc.id);
									socket.broadcast(doc.id+' has been banned!');
									
									// Find connected user with matching IP.
									var user = findClientByIp(doc.id);
									
									// If the banned user is connected,
									// boot them and close the connection.
									if (user) {
										user.send('You have been banned!');
										delete user;
									}
								}
							});
							
							// Only break the switch for admins.
							// Don't want users to know this slashcode exists.
							break;
						}
					
					/**
					 * Notify user of unrecognized slashcodes.
					 */
					default:
						client.send('Unrecognized slashcode.');
				}
			
			// It's a regular message. Broadcast it normally.
			} else {
				socket.broadcast({
					message: msg
					, name: client.user._id
					, admin: client.user.admin
					, ip: client.connection.remoteAddress
				});
			}
		});
			
		// Notify others when a user disconnects.
		client.on('disconnect', function(){
			client.broadcast(client.user._id+' logged out!');
			
			// Track whether a user is currently logged in or not.
			db.users.merge(client.user._id, { loggedin: false }, function(){});
		});
	}
});