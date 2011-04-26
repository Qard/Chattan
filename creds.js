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
	, key: 'lI7LWmKdCBbfTFbqMxcgR6glyNBL52T9+kcL4YXQVs0='
}

module.exports.aws = {
	key: 'AKIAI6FOHDDDFDVWFJNQ'
	, secret: '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'
	, bucket: 'chattan'
};