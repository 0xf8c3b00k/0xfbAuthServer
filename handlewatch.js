var url = require('url');
var uuid = require('node-uuid');
var https = require('https');
var CONFIG = require('./config.js').config;

var useridMap = {};

// Subscription data:
//   clients: an object which key contains all the clients, while values are undefined.
//   subTime: timestamp that subscription request starts.
//   timerId: time out of subscription.
// Client:
//   resp: response object.
//   reqTime: timestamp that this request received.
//   timerId: time out of this request.
//   userId: user id of this client.
//   
var subscribed = {}; // A userid-to-subscription info data structure map

var sendErrorToClient = function(data, client) {
  respStr = JSON.stringify({
    "type": "error",
    "msg" : data
  });

  try {
    var resp = client['resp'];
    resp.end(respStr);
    removeClient(client['userId'], client);
  } catch (e) {
    console.error('Fail to send message to user, message: %s', respStr);
    console.error(e.toString());
  }
};

// Remove a client from subscribed object.
var removeClient = function(userId, client) {
  if (userId !== undefined && subscribed.hasOwnProperty(userId)) {
    var ssData = subscribed[userId];
    var clients = ssData['clients'];
    ssData['clients'] = [];

    for (var i = 0; i < clients.length; i++) {
      if (clients[i] !== client) {
        ssData['clients'].push(clients[i]);
      }
    }
  }
};

var clientTimeout = function(client) {
  if (client['resp'].writable) {
    var resp = client['resp'];
    var timePassed = Date.now() - client['reqTime'];
    var timeLeft = CONFIG['watching_long_polling_time'] - timePassed;
    if (timeLeft > 0) {
      resp.write(" ");  // Make client polling longer.
      client['timerId'] = setTimeout(clientTimeout,
                                     timeLeft > 25000 ? 25000 : timeLeft,
                                     client);
    } else {
      resp.end("[]");
      removeClient(client['userId'], client);
    }
  } else {
    removeClient(client['userId'], client);
  }
};

var verifyToken = '';
var getVerifyToken = function() {
  if (verifyToken === '') {
    verifyToken = uuid.v4();
  }
  return verifyToken;
};

var makePostBody = function(map) {
  var keyArr = Object.keys(map);
  var outputArray = [];
  for (var i = 0; i < keyArr.length; i++) {
    var key = keyArr[i];
    var line = encodeURIComponent(key) + "=" + encodeURIComponent(map[key]);
    outputArray.push(line);
  }
  return outputArray.join("&");
};

var subscribeNotification = function(at, userId, client) {
  client['userId'] = userId;

  // If the user is already subscripted to event, we can just
  // add the client into our list.
  if (subscribed.hasOwnProperty(userId)) {
    subscribed[userId]['clients'].push(client);
    return;
  }

  // ----------------------------
  // Subscribe to Facebook event.
  var vt = getVerifyToken();
  var fail = false;
  var failMsgs = [];
  console.log(JSON.stringify(CONFIG['subscription']));
  var left = Object.keys(CONFIG['subscription']).length;
  var subTime = Date.now();

  var option = {
    "host"    : "graph.facebook.com",
    "port"    : 443,
    "path"    : "/" + CONFIG['fb_client_id'] + '/subscriptions?access_token=' + at,
    "method"  : "POST",
    "headers" : {
      "Content-Type" : "application/x-www-form-urlencoded"
    }
  };  // option

  var responseHandler = function(subObject, resp) {
    if (resp.statusCode != 200) {
      console.error("Fail when subscribe: " + subObject);
      fail = true;
      var data = '';
      resp.on('data', function(buf) {
        data += buf.toString('utf8');
      });
      resp.on('end', function() {
        console.error("error: " + data);
        failMsgs.push(JSON.parse(data));
      });
    } else {
      console.log("Subscribe: %s, for access_token: %s", subObject, at);        
    }

    left--;
    if (left == 0) {
      // All subscription finished.
      if (!fail) {
        // Subscribe all object successfully, and make user wait.
        subscribed[userId] = {
          "clients" : [client],
          "subTime" : subTime,
          "timerId" : setTimeout(subscriptionTimedOut.bind(this, userId),
                                 20 * 3600 * 1000)
        };
      } else {
        sendErrorToClient(failMsgs, client);
      }
    }
  };  // responseHandler

  Object.keys(CONFIG['subscription']).forEach(function(k) {
    var body = makePostBody({
      "object"       : k,
      "fields"       : CONFIG['subscription'][k].join(","),
      "callback_url" : CONFIG["auth_server_host"] + CONFIG["server_watch_callback"],
      "verify_token" : vt
    });
    console.log("Post to scribe: " + body);
    https.request(option, responseHandler.bind(this, k)).end(body);
  });  // forEach

};

var findUseridAndSubscribeNotification = function(at, client) {
  https.get({
    'host': 'graph.facebook.com',
    'path': '/me?access_token=' + at
  }, function(resp) {
    var data = '';
    resp.on('data', function(d) {
      data += d.toString('utf8');
    });
    resp.on('end', function() {
      var id = '';

      try {
        if (resp.statusCode == 200) {
          id = JSON.parse(data)['id'];
          useridMap[at] = id;
          console.log("Got id = " + id);
        } else {
          throw 'Error parsing JSON from FB';
        }
      } catch (e) {
        sendErrorToClient({
          "msg": e.toString()
        }, client);
      }

      subscribeNotification(at, id, client);
    });
  });
}

exports.handleClientWatch = function(app, req, resp) {
  var query = url.parse(req.url, true).query;
  if (query.hasOwnProperty('at')) {
    var at = query['at'];

    var client = {
      'resp' : resp,
      'timerId' : setTimeout(clientTimeout.bind(this, client), 25000),
      'reqTime' : Date.now()
    };

    // Find out user id
    if (useridMap.hasOwnProperty(at)) {
      subscribeNotification(at, useridMap[at], client);
    } else {
      findUseridAndSubscribeNotification(at, client);
    }
  } else {
    resp.statusCode = 500;
    resp.end('You have to full the access token');
  }
};

exports.handleServerGetRequest = function(app, req, resp) {
  var query = url.parse(req.url, true).query;
  if (query['hub_mode'] === 'subscribe' &&
      query['hub_verify_token'] === getVerifyToken()) {
    console.log("Facebook server sent get request");
    resp.statusCode = 200;
    resp.end(query['hub_challenge']);
  }
};

exports.handleServerPostRequest = function(app, req, resp) {
  resp.statusCode = 200;
  resp.end();
};
