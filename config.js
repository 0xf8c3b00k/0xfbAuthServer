exports.config = {
  
  // For 0xfb client.
  'client_waiting_timeout' : 60000, // ms

  // Facebook app id.
  'fb_client_id' : '370477596318204',

  // Facebook auth scope.
  'fb_auth_scope' : [
    'user_groups',
    'user_photos',
    'publish_stream',
    'friends_photos',
    'read_stream',
    'publish_actions'
  ],

  // Path for Facebook's redirect.
  'fb_auth_result_path' : '/fb_auth_done',

  // Facebook app secret. DON'T SEND TO GITHUB
  'fb_app_secret' : '',

  // Our app's address.
  'auth_server_host' : 'https://zeroxf8c3b00k.herokuapp.com',

  // Our site
  '0xfb_site' : 'http://0xf8c3b00k.github.com/0xf8c3b00k/',

  // Favicon
  '0xfb_favicon' : 'https://github.com/0xf8c3b00k/art/raw/master/out/fb-app-16px.gif',

  // Server watch callback
  'server_watch_callback': '/fb_server_watch_callback',

  // Long polling limit of a watching client
  'watching_long_polling_time': 900000, // 15min

  // Subscribe fields
  'subscription': {
    'post': [
      "likes",
      "comments",
    ],
  }
};
