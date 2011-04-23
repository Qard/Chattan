#!/usr/local/bin/node
// Load required modules.
var express = require('express')
	, socket = require('socket.io')
	, cradle = require('cradle')
	, crypto = require('crypto')
	, creds = require('./creds');

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

// Create express server.
var app = express.createServer();

// Configure express to serve static files.
app.configure(function(){
	app.use(express.static(__dirname+'/static'));
});

// Start listening.
app.listen(8124);

// Create generic MOTD.
var motd = 'For help with using CHATTAN!! type /help.';


var usednames = [];
var users = creds.users;
for (var i in users) {
	usednames.push(i);
}

// Encrypt a string.
var text = "123|123123123123123";
var cipher = crypto.createCipher(creds.crypto.mode, creds.crypto.key);
var crypted = cipher.update(text,'utf8','hex');
crypted += cipher.final('hex');

// Decrypt a string.
var decipher = crypto.createDecipher(creds.crypto.mode, creds.crypto.key);
var decrypted = decipher.update(crypted,'hex','utf8');
decrypted += decipher.final('utf8');

console.log([crypted,decrypted]);

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
				var pass = cipher.update(creds.users[i].password,'utf8','hex');
				pass += cipher.final('hex');
				
				// Update password to encrypted value.
				creds.users[i].password = pass;
				
				// Save to database.
				db.users.save(i, creds.users[i], function(){});
			}
		});
	}
}



// Wrap express server
var socket = socket.listen(app);

// Define connection event.
socket.on('connection', function(client){
	// Ignore blacklisted clients.
	if (client.connection && blacklist.indexOf(client.connection.remoteAddress) > -1){
		client.send('You have been banned!');
		delete client;
		return;
	
	// Execute our client management code for non-blacklisted clients.
	} else {
		// Store some data on our client.
		client.user = {
			username: 'Anonymous'
		};
		
		// Notify others when a user connects.
		client.broadcast(client.user.username+' joined!');
		client.send('You have joined as '+client.user.username);
		if (motd){
			client.send('MOTD: '+motd);
		}
		
		// Pass messages to other users.
		client.on('message', function(msg){
			if (client.connection && blacklist.indexOf(client.connection.remoteAddress) > -1){
				client.send('You have been banned!');
				delete client;
				return;
			}

			// Output for logging.
			console.log(msg);
			
			// Check for slash codes
			if (msg[0] == '/'){
				// Split 
				var parts = msg.split(' ');
				var message = parts.slice(1).join(' ');
				
				switch (parts[0]){
					/**
					 * Provide a helpful list of slashcodes to new users.
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
						var user = users[client.user.username];
						if (user && user.admin){
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
						var username = parts[1];
						var password = parts[2];
						
						// Attempt to fetch the user from the database.
						db.users.get(username, function(err, doc) {
							// Make sure that name isn't already taken.
							if ( ! err) {
								client.send('That name is already taken.');
							
							// Otherwise, add user to user list.
							} else {
								// Get old username.
								var old_name = client.user.username;
								
								// Create temporary user object.
								var user = {};
								
								// User existing user data as prototype.
								user.prototype = client.user;
								
								// Move name into doc structure.
								user._id = username;
								user.username = username;
								
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
										socket.broadcast(old_name+' is now '+user.username);
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
						var user = users[parts[1]];
						var username = parts[1];
						var password = parts[2];
						
						// Attempt to fetch the user from the database.
						db.users.get(username, function(err, doc) {
							// Make sure named user exists.
							if (err) {
								client.send('That user does not exist.');
							
							// User exists, prepare to compare passwords.
							} else {
								// Encrypt password.
								var cipher = crypto.createCipher(creds.crypto.mode, creds.crypto.key);
								var password = cipher.update(password,'utf8','hex');
								password += cipher.final('hex');
								
								// Make sure password matches before logging in.
								if (password !== doc.password) {
									client.send('Incorrect password.');
								
								// Password matches.
								} else {
									// Set loggedin state.
									doc.loggedin = true;
									
									// We want to save loggedin state.
									db.users.save(username, doc, function(err) {
										if ( ! err) {
											client.user = doc;
											socket.broadcast(client.user.username+' has logged in.');
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
						socket.broadcast(client.user.username+' '+message);
						break;
					
					/**
					 * Change the Message of the Day.
					 * 
					 * /motd This is the motd!
					 */
					case '/motd':
						// We are only reading the MOTD, just respond.
						if (parts.length === 1) {
							client.send('MOTD: '+motd);
							
						// We are changing the MOTD, we need to verify admin status.
						} else {
							var user = users[client.user.username];
							if (user && user.admin){
								motd = message;
								socket.broadcast('MOTD changed to: '+motd);
							} else {
								client.send('You must be logged in as an admin to do that.');
							}
						}
						break;
					
					/**
					 * Promote user to admin status.
					 * 
					 * /promote username
					 */
					case '/promote':
						var user = users[client.user.username];
						if (user && user.admin){
							var user = users[parts[1]];
							if (user){
								user.admin = true;
								socket.broadcast(parts[1]+' has been promoted to Administrator.');
							} else {
								client.send('No user by that name found.');
							}
						} else {
							client.send('You must be logged in as an admin to do that.');
						}
						break;
					
					/**
					 * Ban a user by IP address.
					 * 
					 * /banip ip
					 */
					case '/banip':
						var user = users[client.user.username];
						if (user && user.admin){
							// Add IP to blacklist.
							blacklist.push(parts[1]);
							socket.broadcast(parts[1]+' has been banned!');
							
							// Loop through all current clients.
							for (var i in socket.clients) {
								// Get client IP.
								var ip = socket.clients[i].connection.remoteAddress;
								
								// If the client IP matches the banned IP, notify and disconnect them.
								if (parts[1] == ip){
									socket.clients[i].send('You have been banned!');
									delete socket.clients[i];
								}
							}
						} else {
							client.send('You must be logged in as an admin to do that.');
						}
						break;
					
					/**
					 * Notify user of unrecognized slashcodes.
					 */
					default:
						client.send('Unrecognized slashcode.');
				}
			
			// It's a regular message. Broadcast it normally.
			} else {
				var user = users[client.user.username] || { admin: false };
				socket.broadcast({
					message: msg
					, name: client.user.username
					, admin: user.admin
					, ip: client.connection.remoteAddress
				});
			}
		});
			
		// Notify others when a user disconnects.
		client.on('disconnect', function(){
			client.broadcast(client.user.username+' logged out!');
			
			// Track whether a user is currently logged in or not.
			var user = users[client.user.username];
			if (user){
				user.loggedin = false;
			}
		});
	}
});