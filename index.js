'use strict';

const
  request = require('request'),
  express = require('express'), 
  crypto = require('crypto'),
  bodyParser = require('body-parser'),  
  app = express();

const
  app_token = process.env.APP_TOKEN,
  app_secret = process.env.APP_SECRET,
  page_token = process.env.PAGE_TOKEN,
  validation_token = process.env.VALIDATION_TOKEN,
  page_id = process.env.PAGE_ID;  

const 
  graph_api_uri = 'https://graph.facebook.com', 
  messenger_api_uri = `${graph_api_uri}/v2.6/me/messages?access_token=${page_token}`,
  place_api_uri = `${graph_api_uri}/v2.10/search?type=place&categories=["FOOD_BEVERAGE"]&access_token=${app_token}`,
  userCache = {};

let message_payload = {};

/*
 * SETUP
 */ 

app.use(bodyParser.urlencoded({ 
  extended: false, 
  verify: verifyRequestSignature 
}));
app.use(bodyParser.json());

app.listen(process.env.PORT || 1337);

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === validation_token) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

app.post('/webhook', (req, res) => {  
  let data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(pageEntry => {
      let pageID = pageEntry.id;
      let timeOfEvent = pageEntry.time;
console.log(JSON.stringify(pageEntry, 2));
      // Iterate over each messaging event
      pageEntry.messaging.forEach(messagingEvent => {

        let ps_user_id = messagingEvent.sender.id;

        if (messagingEvent.postback) {
          handlePostback(ps_user_id, messagingEvent);
        } else if (messagingEvent.message.text) {
          if (messagingEvent.message.quick_reply) {
            handleQuickReply(ps_user_id, messagingEvent);
          } else {
            handleTextMessage(ps_user_id, messagingEvent);
          }          
        } else if (messagingEvent.message.attachments) {          
          handleAttachmentMessage(ps_user_id, messagingEvent)        
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });
  }
  // Assume all went well.
  //
  // You must send back a 200, within 20 seconds, to let us know you've 
  // successfully received the callback. Otherwise, the request will time out.
  res.sendStatus(200);
});

/*
 * MESSAGE HANDLERS
 */ 
function handleTextMessage (ps_user_id, messagingEvent) {   
  let user_info = {};
  let message_text = messagingEvent.message.text;
  let nlp = messagingEvent.message.nlp.entities;

  // setTimeout(() => {
  //   postSenderAction('mark_seen', ps_user_id);    
  //   setTimeout(() => {
  //     postSenderAction('typing_on', ps_user_id)
  //   }, 2000);
  // }, 1500);

  // if(message_text == 'test') {
  //   message_payload = {
  //        "template_type": "media",
  //        "elements": [
  //           {
  //             "media_type": "image",
  //             "media_url": "https://messenger.fb.com/wp-content/uploads/2013/03/messenger.png",
  //             "buttons": [
  //               {
  //                 "type": "web_url",
  //                 "url": "https://tbd-agent.herokuapp.com/webview.html?env=nakuma.sb",
  //                 "title": "View Website",
  //                 "messenger_extensions": true
  //               }
  //             ]
  //           }
  //        ]
  //     }
    
  //   sendMessage(ps_user_id, 'generic template', message_payload);

  // } else 

  if (nlp.greetings && nlp.greetings[0].confidence > 0.75) { 
      
      let user_name = userCache[ps_user_id]['user_info']['first_name'];      
      logUserState(ps_user_id, 'state', 'return');
      
      message_payload = {
        text: `Welcome back, ${user_name}! Ready to search for somewhere new?`        
      }
      sendMessage(ps_user_id, 'text', message_payload);       
  } else if (nlp.intent) {
   
    let nlp_value = nlp.intent[0].value;
    let nlp_confidence = nlp.intent[0].confidence
    
    if (nlp_value == 'affirmative' && nlp_confidence > 0.75) {
      //check what they user is affirming
      switch (userCache[ps_user_id].state) {
        case 'new': 
          logUserState(ps_user_id, 'state', 'location');    
          message_payload = {            
            text: `Sweeeeet. Let's start by getting your location.`,
            quick_replies: [
              { "content_type":"location" }
            ]                      
          }
          sendMessage(ps_user_id, 'quick reply', message_payload);
          break;
        case 'return': 
          let last_location_title = userCache[ps_user_id]['last_location']['title'];
          logUserState(ps_user_id, 'state', 'location');    

          message_payload = {            
            text: `Sounds good! Do you still want to search around ${last_location_title}`            
          }
          sendMessage(ps_user_id, 'text', message_payload);
          break;
        case 'location':                    
          handleAttachmentMessage(ps_user_id);
          break;
      }
    } else if (nlp_value == 'negative' && nlp_confidence > 0.75) {
      switch (userCache[ps_user_id].state) {
        case 'location': 
          message_payload = {            
            text: `Ok, let's get an updated location for you then!`,
            quick_replies: [
              { "content_type":"location" }
            ]                      
          }
          sendMessage(ps_user_id, 'quick reply', message_payload);
          break;
      }
    } 
  } else if (nlp.local_search_query && nlp.local_search_query[0].confidence > 0.75) {    
    let query = nlp.local_search_query[0].value;
    logUserState(ps_user_id, 'last_search', query);
    logUserState(ps_user_id, 'state', 'distance');
    message_payload = {
      text: 'Last thing, I promise. How far do you want me to search from where you are?',
      quick_replies:[
        {
          content_type: 'text',
          title: '3 miles',
          payload: 4827            
        },
        {
          content_type: 'text',
          title: '5 miles',
          payload: 8045             
        },
        {
          content_type: 'text',
          title: '10 miles',
          payload: 16090             
        },
        {
          content_type: 'text',
          title: '20 miles',
          payload: 32180         
        }
      ]
    }    

    sendMessage(ps_user_id, 'quick reply', message_payload);
    
  } 
}

function handleQuickReply (ps_user_id, messagingEvent) {  
  let nlp = messagingEvent.message.nlp.entities;
  
  if (nlp.distance && nlp.distance[0].confidence > 0.75) {     
    let location = userCache[ps_user_id]['last_location'];
    let query = userCache[ps_user_id]['last_search'];
    let distance = messagingEvent.message.quick_reply.payload;
    
    logUserState(ps_user_id, 'last_distance', distance);
    logUserState(ps_user_id, 'state', 'search');
    
    message_payload = {
      text: 'Ok, I\'m on it. Give me just a second.'
    };

    sendMessage(ps_user_id, 'text', message_payload);    

    getPlaces(location, distance, query, (placesResponse) => {
      if (placesResponse.data.length < 1) {
        message_payload = {
          text: 'Hmmmm, sorry, I didn\'t find anything.'
        };
        sendMessage(ps_user_id, 'text', message_payload);
      } else {
        message_payload = {
          text: 'Ok, here are some options.'          
        }
        sendMessage(ps_user_id, 'text', message_payload);

        message_payload = {
          elements: []
        };

        for (let place of placesResponse.data) {
          if (place.cover && place.photos && place.photos.data.length > 2) {
            let place_details = {
              "title": place.name,
              "image_url": place.cover.source,
              "subtitle": `${place.location.street}`,
              "buttons": [{
                  "title": "More Info",
                  "type": "postback",
                  "payload": place.id
              }]
            };
            
            message_payload.elements.push(place_details);
          }

          if (message_payload.elements.length == 4) {
            break;
          } 
        }

        sendMessage(ps_user_id, 'list template', message_payload);
      }
    })

  }
}

function handleAttachmentMessage (ps_user_id, messagingEvent) {
  if (!messagingEvent) {
    message_payload = {
      text: 'Ok, cool. What kind of food do you want this time around?'
    }
  } else if (messagingEvent.message.attachments[0].type == 'location') {    
    let location = {
      coords: messagingEvent.message.attachments[0].payload.coordinates,
      title: messagingEvent.message.attachments[0].title
    };

    logUserState(ps_user_id, 'last_location', location);
    
    message_payload = {
      text: 'Ok, I\'ve got your location. Thanks for that. \nWhat kind of food are you looking for?'
    }  
  }


  sendMessage(ps_user_id, 'text', message_payload);
}


function handlePostback(ps_user_id, messagingEvent) {
  
  if (messagingEvent.postback.payload == 'new user') {
    getUserInfo(ps_user_id, user_info => {
      let user_name = user_info.first_name;
      logUserState(ps_user_id, 'state', 'new');
      logUserState(ps_user_id, 'user_info', user_info);
      message_payload = {
        text: `Hi, ${user_name}! I'm the PlacesBot. I can find businesses near you. Wanna get started?`        
      }
      sendMessage(ps_user_id, 'text', message_payload);        
    })    
  } else {
    let pageId = messagingEvent.postback.payload;    
    getPlaceInfo(pageId, (placeInfo) => {
      let subtitle = `${placeInfo.location.street}`

      logUserState(ps_user_id, 'state', 'done');

      if (placeInfo.overall_star_rating) {
        subtitle += `\nRated ${placeInfo.overall_star_rating}`;
      }
      
      if (placeInfo.price_range) {
        subtitle += `\n${placeInfo.price_range}`; 
      }

      if (placeInfo.hours) {
        let hours = getFormattedHours(placeInfo.hours);        
        subtitle += `\nOpen Hours: ${hours.open_time} - ${hours.close_time}`;
      }    

      if (placeInfo.photos) {            
        logUserState(ps_user_id, 'photos', placeInfo.photos.data);
      }

      message_payload = {
        elements: [
          {
            "title": placeInfo.name,
            "image_url": placeInfo.cover.source,
            "subtitle": subtitle,
            "buttons":[
              {
                "type":"phone_number",
                "title":"Call",
                "payload": placeInfo.phone.replace(/\D/g, '')
              },
              {
                "type":"web_url",
                "title":"View Website",
                "url": placeInfo.website
              },
              {
                "type":"web_url",
                "title":"See Photos",
                "url": "https://porcupo.net/alex",
                "messenger_extensions": true
              }              
            ]      
          }
        ]
      }

      sendMessage(ps_user_id, 'generic template', message_payload);
    })
  }
}

/*
 * API CALLS
 */ 
function postSenderAction (sender_action, ps_user_id, callback) {
  let timeout = 0;
  let request_body = {
    recipient: {
      id: ps_user_id      
    },
    sender_action: sender_action
  }

  request.post(messenger_api_uri, {form: request_body}, (err, res, body) => {
    
    if (err) {
      console.error(err);
    }
  })
}

function getUserInfo (ps_user_id, callback) {
  let user_fields = 'first_name, last_name, timezone, is_payment_enabled';
  let uri = `${graph_api_uri}/v2.6/${ps_user_id}?field=${user_fields}&access_token=${page_token}`;
  
  request.get(uri, (err, res, body) => {
    callback(JSON.parse(body));
  });
}

function getPlaces (location, search_radius, query, callback) {
  let fields = 'name, phone, location, cover, link, website, photos';
  let qs = `&fields=${fields}&q=${query}&center=${location.coords.lat},${location.coords.long}&distance=${search_radius}`;
  let request_uri = `${place_api_uri}${qs}`;

  request.get(request_uri, (req, res, body) => {
    callback(JSON.parse(body));
  })

}

function getPlaceInfo (placeId, callback) {
  let fields = 'name, phone, location, cover, overall_star_rating, rating_count, price_range, hours, website, photos';  
  let qs = `fields=${fields}&access_token=${app_token}`;
  let request_uri = `${graph_api_uri}/v2.10/${placeId}?${qs}`;

  request.get(request_uri, (req, res, body) => {
    callback(JSON.parse(body));
  })

}


/*
 * UTILITY FUNCTIONS
 */ 
function sendMessage (ps_user_id, type, message_payload) {
console.log(message_payload);     
  let request_body = {
    recipient: {
      id: ps_user_id
    },
    message:{}
  }

  switch (type) {
    case 'text':
      request_body.message = {
        text: message_payload.text,
        metadata: message_payload.metadata
      }
      break;

    case 'quick reply':
      request_body.message = {
        text: message_payload.text,
        quick_replies: message_payload.quick_replies
      }
      break;
    case 'button template':
      request_body.message = {
        attachment:{
          type:'template',
          payload:{
            template_type: 'button',
            text: message_payload.text,
            buttons: message_payload.buttons
          }
        }      
      }
      break;
    case 'generic template':
      request_body.message = {
        attachment:{
          type:'template',
          payload:{
            template_type: 'generic',
            elements: message_payload.elements
          }
        }      
      }
      break;
    case 'list template':
      request_body.message = {
        attachment:{
          type:'template',
          payload:{
            template_type: 'list',
            elements: message_payload.elements
          }
        }      
      }
console.log(JSON.stringify(request_body));      
      break;
    default:
      request_body.message.attachment = {       
        type: type,
        payload: message_payload
      }
  }

  request.post(messenger_api_uri, {form: request_body}, (err, res, body) => {
    if (!err && res.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", res.statusCode, res.statusMessage, JSON.parse(body).error);
    }
  });
  
}

function verifyRequestSignature(req, res, buf) {
  let signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an 
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    let elements = signature.split('=');
    let method = elements[0];
    let signatureHash = elements[1];

    let expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

function getFormattedHours(hours) {
  let day_of_week = getDayOfWeek();
  let open_time = hours[day_of_week + '_1_open'];
  let close_time = hours[day_of_week + '_1_close'];
  let open_time_parsed = open_time.split(':');
  let close_time_parsed = close_time.split(':');
  if (open_time_parsed[0] < 12) {    
   open_time += 'am';
  } else {
    open_time_parsed[0] = open_time_parsed[0] - 12;
    open_time = `${open_time_parsed[0]}:${open_time_parsed[1]}pm`
  }
  if (close_time_parsed[0] < 12) {    
   close_time += 'am';
  } else {
    close_time_parsed[0] = close_time_parsed[0] - 12;
    close_time = `${close_time_parsed[0]}:${close_time_parsed[1]}pm`
  }
  return {open_time: open_time, close_time: close_time};
}

function getDayOfWeek () {
  let today = new Date(Date.now()).getDay();
  switch (today) {
    case 0: 
      today = 'sun';
      break;
    case 1: 
      today = 'mon';
      break;
    case 2: 
      today = 'tue';
      break;
    case 3: 
      today = 'wed';
      break;
    case 4: 
      today = 'thu';
      break;
    case 5: 
      today = 'fri';
      break;
    case 6: 
      today = 'sat';
      break;
  }
  return today;
}

function logUserState (ps_user_id, key, value) {
  if (ps_user_id && !userCache[ps_user_id]) {
    userCache[ps_user_id] = {};
  }

  if (key && value) {
    userCache[ps_user_id][key] = value;
  }  
}

function decryptExtensionsRequest (hash) {
  let request = hash.split('.');
  let signature = request[0].replace('-','+').replace('_', '/');  
  signature = Buffer.from(signature, 'base64').toString('hex');
  let payload = Buffer.from(request[1], 'base64').toString('ascii')

  let expected_signature = crypto.createHmac('sha256', app_secret)
                            .update(request[1])
                            .digest('hex');
  // Confirm the signature
  if (signature !== expected_signature) {
    error_log('Bad Signed JSON signature!');
    return null;
  }

  return payload;
}

app.get('/pictures', (req, res) => {
  let hash = req.query.hash;
  let body = JSON.parse(decryptExtensionsRequest(hash));
  
  if (body) {
    let photoUrlArr = [];
    let photosArr = userCache[body.psid]['photos'];  
    let batchRequest = [];
    photosArr.forEach(photo => {
console.log('GET PHOTO');      
      batchRequest.push({"method":"GET", "relative_url":`v2.10/${photo.id}?fields=images`});
    })

    let request_body = {
      batch: JSON.stringify(batchRequest),
      include_headers: false
    } 
    request.post(`${graph_api_uri}?access_token=${app_token}`, {form: request_body}, (photoreq, photores, body) => {
      
      body = JSON.parse(body);
      
      body.forEach(photo => {
        let images = JSON.parse(photo.body).images;
        for (let i in images) {
          if (images[i].height <= 200) {
            photoUrlArr.push(images[i].source);
            break;
          }
            
        }
      })
      
      res.json({"photos": photoUrlArr});
    })  
      
  } else {
    res.sendStatus(400);
  }
  
})


app.use('/', 
  (req, res, next) => {    
    let referer = req.get('Referer');
    if (referer.indexOf('www.messenger.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.messenger.com/');
    } else if (referer.indexOf('www.facebook.com') >= 0) {
      res.setHeader('X-Frame-Options', 'ALLOW-FROM https://www.facebook.com/');
    }
    next();
  }, 
  express.static(__dirname + '/www')
);

