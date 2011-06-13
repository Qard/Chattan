var socket = require('socket.io');

module.exports.listen = function(db, app){
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
			
			anonLoggedIn++;
			
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
								, '/who - Get a list of all users currently logged in.'
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
							var msg = '<p>'+[
								'NEW FEATURE: Uploads! You can now upload files to Chattan'
								, 'by either clicking the upload button or dropping a file'
								, 'onto the message bar at the bottom of the screen.'
							].join(' ')+'</p>';
							msg += 'There are many text filters to convert URLs to embedded content, including:';
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
									var pass = cipher.update(password,'utf8','hex');
									pass += cipher.final('hex');
									
									// Update password to encrypted value.
									user.password = pass;
									
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
									var pass = decipher.update(doc.password, 'hex', 'utf8');
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
												// Update with user data retrieved from database.
												client.user = doc;
												
												// No longer anonymous.
												anonLoggedIn--;
												
												// Add named user to list of logged in users.
												loggedIn.push(username);
												
												// Notify all clients.
												socket.broadcast(client.user._id+' has logged in.');
											}
										});
										
										// Get subscription list.
										db.subscriptions.get('qard', function(err, doc){
											if ( ! err) {
												doc.feeds.forEach(function(val){
													// Generate a subscription update event for this feed item.
													emitter.on('subscriptionUpdate-'+val, function(obj){
														console.log(obj);
														client.send(obj);
													});
												});
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
												socket.broadcast(username+' has been promoted to Administrator.');
												
												// Overwrite actual user data with temporary data.
												var user = findClientByName(username);
												
												// Only try to change live client status
												// if that user is currently connected.
												if (user) {
													user.admin = true;
												}
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
						 * Get a list of currently logged in users.
						 * 
						 * /who
						 */
						case '/who':
							client.send(
								anonLoggedIn+' anonymous users'
								+(loggedIn.length
									? ' and '+loggedIn.length+' named users ('+loggedIn.join(', ')+')'
									: ''
								)
								+' currently logged in.'
							);
							break;
						
						/**
						 * Subscribe to Feed URL.
						 * 
						 * /subscribe
						 */
						case '/subscribe':
							client.send(
								anonLoggedIn+' anonymous users'
								+(loggedIn.length
									? ' and '+loggedIn.length+' named users ('+loggedIn.join(', ')+')'
									: ''
								)
								+' currently logged in.'
							);
							break;
						
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
				
				if (client.user._id === 'Anonymous') {
					anonLoggedIn--;
				} else {
					// Track whether a user is currently logged in or not.
					db.users.merge(client.user._id, { loggedin: false }, function(){});
					
					// Get index of username in logged in users list.
					var index = loggedIn.indexOf(client.user._id);
					
					// Remove item from logged in users list.
					loggedIn.splice(index);
				}
			});
		}
	});
	
	return socket;
}