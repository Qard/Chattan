#!/usr/local/bin/node
// Load required modules.
var creds = require('./creds')
	, file = require('fs')
	, s3 = require('knox');

/**
 * Generate Unique ID with or without prepended timestamp.
 * Don't try to understand th logic. There isn't any.
 */
var uid = function(count, useDate){
	var res = [];
	for (var i = 0; i < (count || 16); i++) {
		res.push(String.fromCharCode(Math.floor(
      Math.floor(Math.random()*2)?(Math.floor(Math.random()*2)?65+(Math.random()*26):97+(Math.random()*26)):48+(Math.random()*10)
    )));
	}
	return (useDate?(new Date).getTime().toString()+'_':'')+res.join('');
};

module.exports.listen = function(app, aws){
	// Check if the server is running locally.
	var isLocal = ( ! process.env['DUOSTACK_APP_NAME'] || ! aws);
	
	// Connect to S3 bucket.
	if ( ! isLocal) {
		var bucket = s3.createClient({
			key: aws.key
			, secret: aws.secret
			, bucket: aws.bucket
		});
	}
	
	// Create a generic upload request handler.
	var uploadHandler = function(req, res) {
		// Build unique filename.
		var filename = uid(32)+'_'+req.header('x-file-name');
		var path = (isLocal ? 'public/uploads' : 'mnt')+'/'+filename;
		
		// Prepare WriteStream.
		var stream = file.createWriteStream(path);
		
		// Resume read stream after write stream has drained.
		stream.on('drain', function(){
			req.resume();
		});
		
		// When the WriteStream closes we are ready to push to S3.
		stream.on('close', function(){
			// Assume some filedata.
			var filedata = {
				name: req.header('x-file-name')
				, size: req.header('x-file-size')
				, type: req.header('x-file-type')
			};
			
			// Check if we have AWS Credentials.
			if ( ! isLocal) {
				// Push newly uploaded file to S3.
				bucket.putFile(path, '/'+filename, function(err, response){
					if (err) {
						console.log(err);
					
					// No errors, respond to the client!
					} else {
						// Create a JSON object describing the file and it's location.
						filedata.path = 'http://'+aws.bucket+'.s3.amazonaws.com/'+filename
						var json = JSON.stringify(filedata);
						
						// Send JSON response to client.
						res.contentType('json');
						res.header('Content-Length', json.length);
						res.send(json);
						
						// Delete the locally stored file if we are using S3.
						file.unlink(path);
					}
				});
			
			// No AWS credentials, store locally.
			} else {
				// Create a JSON object describing the file and it's location.
				filedata.path = 'http://'+req.header('host')+'/uploads/'+filename;
				var json = JSON.stringify(filedata);
				
				// Send JSON response to client.
				res.contentType('json');
				res.header('Content-Length', json.length);
				res.send(json);
			}
		});
			
		
		// Watch for data chunks.
		req.on('data', function(chunk){
			// Pause ReadStream to wait for WriteStream.
			req.pause();
			
			// Write to WriteStream.
			stream.write(chunk);
		});
		
		// When ReadStream completes, close WriteStream.
		req.on('end', function(){
			stream.end();
		});
	};

	app.put('/upload', uploadHandler);
	app.post('/upload', uploadHandler);
	
	return app;
}