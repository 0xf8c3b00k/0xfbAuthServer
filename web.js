var CONFIG = require('./config.js').config;
var express = require('express');
var crypto = require('crypto');

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
    var waitingStruct = {
      response: resp,
      timeout: setTimeout(
        // Auth client didn't obtain access token in time, 
        // notify 0xfb client timed out, clear token from
        // waiting list.
        function() {
          console.log('%s timeout', token);
          resp.send(generateResponse(0, 'timed out'));
          delete waitingList[token];
        },
        CONFIG['client_waiting_timeout'])
    };
    console.log("Waiting started. token: %s, timeout: %d ms",
                token, CONFIG['client_waiting_timeout']);
    waitingList[token] = waitingStruct;
  } else {
    resp.send('Need token');
  }
});

// Called by facebook's forwarding. Handle auth result.
app.get('/fb_auth_done', function(req, resp) {
  var q = req.query;
  
  // state is set when auth client typing, and will be forwarded by
  // facebook. It should contains a token.
  if (q.hasOwnProperty('state')) {
    var token = q['state'];
    if (waitingList.hasOwnProperty(token)) {
      var ws = waitingList[token];
      clearTimeout(ws.timeout);
      if (q.hasOwnProperty('access_token')) {
        ws.response.send(generateResponse(1, 'auth successed', {
          'access_token': q['access_token']
        }));
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
