var CONFIG = require('./config.js').config;
var express = require('express');
var crypto = require('crypto');
var https = require('https');

// Expecting process:
// 1. 0xfb client connects to /0xfb_client_token to obtain a token.
//
// 2. 0xfb client advertise user to use his own browser to open
//      /auth_client_request?t=<TOKEN>
//    and 0xfb client itself connects to
//      /0xfb_client_wait?t=<TOKEN>
//    and waits access token.
//
// 3. Auth client (user's another browser that is logged in Facebook, and
//    is to done the auth process.) connect to
//      /auth_client_request?t=<TOKEN>
//    and will be forward to facebook's auth page
//
// 4. Auth client is forwarded to 
//      /fb_auth_done?status=<TOKEN>
//    by Facebook. Server pass access_token to 0xfb client, and process
//    is done.


// A table that maps token to waitingStruct;
var waitingList = {};

var tokenGenerator = function(cb) {
  crypto.randomBytes(8, function(ex, buf) {
    var s1 = buf.readUInt32LE(0).toString(36);
    var s2 = buf.readUInt32LE(4).toString(36);
    cb(s1 + s2);
  });
};

var generateEncodedRedirectUri = function() {
  return encodeURIComponent(
    CONFIG['auth_server_host'] + CONFIG['fb_auth_result_path']);
}

var generateResponse = function(success, msg, payload) {
  var r = {
    'success' : success,
    'message' : msg,
  };

  if (payload !== undefined) {
    r['payload'] = payload;
  }
  
  return JSON.stringify(r);
}

// -----------------------------------------------------------------------------
// Server

var app = express.createServer(express.logger());

app.get('/', function(req, resp) {
  resp.send('Hello World!');
});

// For 0xfb client require a token. We send a token back (we may not
// have to store it, if we can route access token correctly to the 0xfb client
// letter wait for it).
app.get('/0xfb_client_token', function(req, resp) {
  tokenGenerator(function(token) {
    resp.send(token);
  });
});

// For 0xfb client to wait facebook token.
app.get('/0xfb_client_wait', function(req, resp) {
  // GET method, with parameter 't' is the token.
  var q = req.query;
  if (q.hasOwnProperty('t')) {
    var token = q['t'];

    if (waitingList.hasOwnProperty(token)) {
      // Token is already set to wait. We should prevent another client
      // from replacing it. (Or a security hole may occur.)
      resp.send(generateResponse(0, 'token is waiting'));
    } else {
      // Build a waiting sturct that holds the data structure to communicate
      // with current client.
      var waitingStruct = {
        response: resp,
        waiting: true, // False if it is 'writing'
        timeout: setTimeout(
          // Auth client didn't obtain access token in time, 
          // notify 0xfb client timed out, clear token from
          // waiting list.
          function() {
            console.log('%s timeout', token);
            waitingStruct.waiting = false;
            resp.send(generateResponse(0, 'timed out'));
            delete waitingList[token];
          },
          CONFIG['client_waiting_timeout'])
      };

      // Send a space each 25 second before it's timed out. To prevent
      // heroku from timed out.
      var resetKeepAliveTimer = function() {
        setTimeout(function() {
          if (waitingStruct.waiting) {
            resp.write(' ');
            resetKeepAliveTimer();
          }
        }, 25000);
      };
      resetKeepAliveTimer();

      console.log("Waiting started. token: %s, timeout: %d ms",
                  token, CONFIG['client_waiting_timeout']);
      waitingList[token] = waitingStruct;
    }

  } else {
    resp.send(generateResponse(0, 'Need token'));
  }
});

// Called by auth client. With a parameter 't' that holds the token.
app.get('/auth_client_request', function(req, resp) {
  var q = req.query;

  if (q.hasOwnProperty('t')) {
    var token = q['t'];
    // Make sure that there is a 0xfb client is waiting access_token by
    // the token.
    if (waitingList.hasOwnProperty(token)) {
      // Forward to facebook, start a server side auth.
      var redirectTo = "https://www.facebook.com/dialog/oauth?" +
        "client_id=" + CONFIG['fb_client_id'] +
        "&redirect_uri=" + generateEncodedRedirectUri() +
        "&scope=" + CONFIG['fb_auth_scope'].join(',') +
        "&state=" + token;
      console.log("Dest: %s", redirectTo);
      resp.header('Location', redirectTo);
      resp.send(301);
    } else {
      // There is no 0xfb client is waiting, may misused or timed out.
      // Notify user.
      resp.send(generateResponse(0, 'No such token'));
    }

  } else {
    resp.send(generateResponse(0, 'Need token'));
  }
});

// Called by facebook's forwarding. Handle auth result, in this step, we should
// get the 'code' from facebook.
app.get(CONFIG['fb_auth_result_path'], function(req, resp) {
  var q = req.query;
  
  // state is set when auth client typing, and will be forwarded by
  // facebook. It should contains a token.
  if (q.hasOwnProperty('state')) {
    var token = q['state'];
    if (waitingList.hasOwnProperty(token)) {

      var ws = waitingList[token];
      clearTimeout(ws.timeout);
      ws.waiting = false;

      if (q.hasOwnProperty('code')) {
        // We got 'code' from Facebook, so we can use this code to get
        // access_token.
        var fbCode = q['code'];
        https.get({
          'host' : 'graph.facebook.com',
          'path' : '/oauth/access_token' +
            '?client_id=' + CONFIG['fb_client_id'] +
            '&redirect_uri=' + generateEncodedRedirectUri() +
            '&client_secret=' + CONFIG['fb_app_secret'] +
            '&code=' + fbCode
        }, function(fbResp) {

          var fbRespStr = '';
          fbResp.on('data', function(buf) {
            fbRespStr = fbRespStr + buf.toString('utf8');
          });

          fbResp.on('end', function() {
            // Parse response
            console.log(fbRespStr);
            var fbRespStrPart = fbRespStr.split('&');
            var access_token = fbRespStrPart[0].split('=')[1];
            var expires = fbRespStrPart[1].split('=')[1];

            ws.response.send(generateResponse(1, 'auth successed', {
              'access_token': access_token,
              'expires' : expires,
            }));
          });
          // Here done the auth procedure.

        });

      } else {
        we.response.send(generateResponse(0, 'auth failed'));
      }

      // Remove handled token.
      delete waitingList[token];

      resp.send(generateResponse(1, 'result is passed'));
    } else {
      resp.send(generateResponse(0, 'token is invalid'));
    }
  } else {
    resp.send(generateResponse(0, 'token is not set'));
  }
});

var port = process.env.PORT || 3000;
app.listen(port, function() {
  console.log("Listening on " + port);
});
