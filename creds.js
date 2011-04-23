// Default users to add to the database, if they don't exist.
module.exports.users = {
	'qard': {
		password: 'st1ckm4n'
		, admin: true
		, loggedin: false
	}
};

// Cloudant CouchDB credentials.
module.exports.cloudant = {
	  username: "chattan",
	  password: "o|ev332h"
};

// Crypto settings.
module.exports.crypto = {
	mode: 'aes-256-cbc'
	, key: 'G*(&UGBIug987gHO&Uoguo9u&_f$7%3@'
}