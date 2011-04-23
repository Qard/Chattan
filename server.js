#!/usr/local/bin/node
var express = require('express')
	, socket = require('socket.io')
	, pathToFiles = '/static'
	, clients = [];

var app = express.createServer();

app.configure(function(){
	app.use(express.static(__dirname+'/static'));
});

app.listen(8124, '127.0.0.1');

// Wrap Connect server
var socket = socket.listen(app);

var blacklist = [];
var motd = 'For help with using CHATTAN!! type /help.';
var usednames = [];
var users = require('./creds');
for (var i in users) {
	usednames.push(i);
}

// Define connection event.
socket.on('connection', function(client){
	// Ignore blacklisted clients.
	if (client.connection && blacklist.indexOf(client.connection.remoteAddress) > -1){
		client.send('You have been banned!');
		client = null;
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
				client = null;
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
						// Make sure that name isn't already taken.
						if (users[parts[1]]){
							client.send('That name is already taken.');
						
						// Otherwise, add user to user list.
						} else {
							users[parts[1]] = {
								password: parts[2] || ''
								, admin: false
								, loggedin: true
							};
							var old_name = client.user.username;
							client.user.username = parts[1];
							socket.broadcast(old_name+' is now '+client.user.username);
						}
						break;
					
					/**
					 * Login using an existing user account.
					 * 
					 * /login username password
					 */
					case '/login':
						var user = users[parts[1]];
						if (user){
							if (parts[2] == user.password){
								client.user.username = parts[1];
								socket.broadcast(client.user.username+' has logged in.');
							} else {
								client.send('Incorrect password.');
							}
						} else {
							client.send('That name is not registered yet. Try using "/register username password" first.');
						}
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
					 * TODO: Make admin-only!
					 * 
					 * /motd This is the motd!
					 */
					case '/motd':
						var admin = users[client.user.username];
						if (admin){
							if (admin.admin){
								motd = message;
								socket.broadcast('MOTD changed to: '+motd);
							} else {
								client.send('You must be an admin to do that.');
							}
						} else {
							client.send('You must be logged in to do that.');
						}
						break;
					
					/**
					 * Change the Message of the Day.
					 * TODO: Make admin-only!
					 * 
					 * /motd This is the motd!
					 */
					case '/promote':
						var admin = users[client.user.username];
						if (admin){
							if (admin.admin){
								var user = users[parts[1]];
								if (user){
									user.admin = true;
									socket.broadcast(parts[1]+' has been promoted to Administrator.');
								} else {
									client.send('No user by that name found.');
								}
							} else {
								client.send('You must be an admin to do that.');
							}
						} else {
							client.send('You must be logged in to do that.');
						}
						break;
					
					/**
					 * Ban a user by IP address.
					 * 
					 * /banip ip
					 */
					case '/banip':
						var admin = users[client.user.username];
						if (admin){
							if (admin.admin){
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
										socket.clients[i] = null;
									}
								}
							} else {
								client.send('You must be an admin to do that.');
							}
						} else {
							client.send('You must be logged in to do that.');
						}
						break;
					
					/**
					 * Notify user of unrecognized slashcodes.
					 */
					default:
						client.send('Unrecognized slashcode.');
				}
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