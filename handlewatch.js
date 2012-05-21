var url    = require('url');
var uuid   = require('node-uuid');
var https  = require('https');
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
var waitingUser = {}; // A userid id-to-client structure map

var sendErrorToClient = function(data, client) {
  respStr = JSON.stringify({
    "type": "error",
    "msg" : data
  });

  try {
    var resp = client['resp'];
    resp.end(respStr);
    removeClient(client);
  } catch (e) {
    console.error('Fail to send message to user, message: %s', respStr);
    console.error(e.toString());
  }
};

// Remove a client from subscribed object.
var removeClient = function(client) {
  var userId = client['userId'];
  if (waitingUser.hasOwnProperty(userId)) {
    var clients = waitingUser[userId];
    waitingUser[userId] = [];

    for (var i = 0; i < clients.length; i++) {
      if (clients[i] !== client) {
        waitingUser[userId].push(clients[i]);
      }
    }

    if (waitingUser[userId].length == 0) {
      delete waitingUser[userId];
    }
  }
};

// Write to user and disconnect to he/her.
var flushClient = function(data, client) {
  if (client['resp'].writable) {
    client['resp'].end(data);
  }
  removeClient(client);
}

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
      flushClient("[]", client);
    }
  } else {
    removeClient(client);
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

var subscribed = 0; // 0: not subscribed, 1: subscribed, 2: doing subscribe.
var subscribeNotification = function(at) {
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
      console.log("Subscribe: " + subObject);        
    }

    left--;
    if (left == 0) {
      // All subscription finished.
      if (!fail) {
        subscribed = 1;
      } else {
        subscribed = 0;
        console.error("Fail to subscribe real time update: " +
                      JSON.stringify(failMsgs));
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

exports.subscribeRealtimeUpdate = function() {
  if (subscribed !== 0) {
    return;
  }

  subscribed = 2;

  // Find access token, then subscribe notification.
  https.get({
    "host": "graph.facebook.com",
    "path": "/oauth/access_token?client_id=" + CONFIG['fb_client_id'] +
      "&client_secret=" + CONFIG['fb_app_secret'] +
      "&grant_type=client_credentials"
  }, function(resp) {
    var data = "";
    resp.on("data", function(d) {
      data += d.toString('utf8');
    });
    resp.on("end", function() {
      if (resp.statusCode === 200) {
        subscribeNotification(data.split("=")[1]);
      } else {
        console.error("Error when getting app's access token, message: " +
                      data + ", status code: " + resp.statusCode);
        subscribed = 0;
      }
    });
  });
}

exports.handleClientWatch = function(app, req, resp) {
  var query = url.parse(req.url, true).query;
  if (query.hasOwnProperty('uid')) {
    var uid = query['uid'];

    var client = {
      'resp'    : resp,
      'timerId' : setTimeout(clientTimeout.bind(this, client), 25000),
      'reqTime' : Date.now(),
      'userId'  : uid
    };

    if (waitingUser.hasOwnProperty(uid)) {
      waitingUser[uid].push(client);
    } else {
      waitingUser[uid] = [client];
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
  console.log("Received rt update!");
  resp.statusCode = 200;
  resp.end();
};
