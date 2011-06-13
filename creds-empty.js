// Default users to add to the database, if they don't exist.
module.exports.users = {
	'username': {
		password: ''
		, admin: true
		, loggedin: false
	}
};

// Cloudant CouchDB credentials.
module.exports.cloudant = {
	  username: "",
	  password: ""
};

// Crypto settings.
module.exports.crypto = {
	mode: 'aes-256-cbc'
	, key: ''
}

module.exports.aws = {
	key: ''
	, secret: ''
	, bucket: ''
};