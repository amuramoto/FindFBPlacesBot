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
app.use(express.static(__dirname + '/www'));
console.log(process.env.PORT);
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

  setTimeout(() => {
    postSenderAction('mark_seen', ps_user_id);    
    setTimeout(() => {
      postSenderAction('typing_on', ps_user_id)
    }, 2000);
  }, 1500);

      
  if (nlp.greetings && nlp.greetings[0].confidence > 0.75) { 
      
      let user_name = userCache[ps_user_id]['user_info']['first_name'];      
      logUserState(ps_user_id, 'state', 'greetings');
      
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
        case 'greetings': 
          
          message_payload = {            
            text: `Sweeeeet. Let's start by getting your location.`,
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
    logUserState(ps_user_id, 'query', query);
    message_payload = {
      text: 'Last thing, I promise. How far do you want me to search from where you are?',
      quick_replies:[
        {
          content_type: 'text',
          title: '0.5 miles',
          payload: 804            
        },
        {
          content_type: 'text',
          title: '1 mile',
          payload: 1609            
        },
        {
          content_type: 'text',
          title: '3 miles',
          payload: 4827            
        },
        {
          content_type: 'text',
          title: '5 miles',
          payload: 8045             
        }
      ]
    }    

    sendMessage(ps_user_id, 'quick reply', message_payload);
    
  } 
}

function handleQuickReply (ps_user_id, messagingEvent) {
  let location = userCache[ps_user_id]['location'];
  let search_radius = messagingEvent.message.quick_reply.payload;
  let query = userCache[ps_user_id]['query'];
  let nlp = messagingEvent.message.nlp.entities;
  let today = getDayOfWeek();

  if (nlp.distance && nlp.distance[0].confidence > 0.75) {     

    message_payload = {
      type: 'text',
      payload: {
        text: 'Ok, I\'m on it. Give me just a second.',
        metadata: messagingEvent.message.quick_reply.payload
      }
    }

    sendMessage(ps_user_id, 'text', message_payload);    

    getPlaces(location, search_radius, query, (placesResponse) => {
console.log(placesResponse);
      if (placesResponse.data.length == 0) {
        message_payload = {
          text: 'Hmmmm, sorry, I didn\'t find anything.'
        }
        sendMessage(ps_user_id, 'text', message_payload);
      } else {
        message_payload = {
          text: 'Ok, here are some options.'          
        }
        sendMessage(ps_user_id, 'text', message_payload);

        message_payload = {
          elements: []
        }

        for (let place of placesResponse.data) {

          if (place.cover) {
            let place_details = {
              "title": place.name,
              "image_url": place.cover.source,
              "subtitle": `${place.location.street}`,
              "buttons": [
                  {
                      "title": "More Info",
                      "type": "postback",
                      "payload": place.id
                  }
              ]
            }
            
            message_payload.elements.push(place_details);
          }

          if (message_payload.elements.length == 4) {
            break;
          } 
        }

        sendMessage(ps_user_id, 'list template', message_payload)
      }
    })

  }
}

function handleAttachmentMessage (ps_user_id, messagingEvent) {
  if (messagingEvent.message.attachments[0].type == 'location') {    
    let location = messagingEvent.message.attachments[0].payload.coordinates;
    logUserState(ps_user_id, 'location', location);
    message_payload = {
      text: 'Ok, I\'ve got your location. Thanks for that. \nWhat kind of food are you looking for?'
    }

    sendMessage(ps_user_id, 'text', message_payload);
  }
}


function handlePostback(ps_user_id, messagingEvent) {
  
  if (messagingEvent.postback.payload == 'new user') {
    getUserInfo(ps_user_id, user_info => {
      let user_name = user_info.first_name;
      logUserState(ps_user_id, 'state', 'greetings');
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
  let fields = 'name, phone, location, cover, link, website';
  let qs = `&fields=${fields}&q=${query}&center=${location.lat},${location.long}&distance=${search_radius}`;
  let request_uri = `${place_api_uri}${qs}`;

  request.get(request_uri, (req, res, body) => {
    callback(JSON.parse(body));
  })

}

function getPlaceInfo (placeId, callback) {
  let fields = 'name, phone, location, cover, overall_star_rating, rating_count, price_range, hours, website';  
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