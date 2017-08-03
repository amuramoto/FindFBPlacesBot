'use strict';

const
	app_token = process.env.APP_TOKEN,
	app_secret = process.env.APP_SECRET,
	page_token = process.env.PAGE_TOKEN,
	validation_token = process.env.VALIDATION_TOKEN,
	page_id = process.env.PAGE_ID,
	request = require('request'),
	express = require('express'),
	app = express(),
	crypto = require('crypto'),
	bodyParser = require('body-parser'),
	graph_api_url = 'https://graph.facebook.com',	
	messenger_api_url = `${graph_api_url}/v2.6/me/messages?access_token=${page_token}`,
	place_api_url = `${graph_api_url}/v2.10/search?access_token=${app_token}`;

app.use(bodyParser.urlencoded({ 
	extended: false, 
	verify: verifyRequestSignature 
}))
app.use(bodyParser.json())
app.use(express.static(__dirname + '/www'));

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

      // Iterate over each messaging event
      pageEntry.messaging.forEach(messagingEvent => {
console.log('PLACES: '+ JSON.stringify(messagingEvent));
        if (messagingEvent.message && !messagingEvent.message.isEcho) {          
          handleMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          // handleDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          // handlePostback(messagingEvent);
        } else if (messagingEvent.read) {
          // handleMessageRead(messagingEvent);
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

function handleMessage (messagingEvent) {
	let message_payload = {};
	let user_info = {};
	let ps_user_id = messagingEvent.sender.id;
	let message_text = messagingEvent.message.text;
	let nlp = messagingEvent.message.nlp;


	postSenderAction('mark_seen', ps_user_id);	

	getUserInfo(ps_user_id, user_info => {
		user_info = JSON.parse(user_info);
		console.log(user_info);
		console.log(typeof user_info);
		if (nlp.entities.greetings && nlp.entities.greetings[0].confidence > 0.75) { 
			message_payload = {
				type: 'text',
				payload: {
					text: `Hi, ${user_info.first_name}! What can I do for you?`,
					metadata: 'test'
				}
			}
		}
		sendMessage(ps_user_id, 'text', message_payload);	
	});

}

function sendMessage (ps_user_id, type, message_payload) {
	let request_body = {
    recipient: {
      id: ps_user_id
    },
    message:{}
  }

	switch (type) {
		case 'text':
			request_body.message = {
				text: message_payload.payload.text,
				metadata: message_payload.payload.metadata
			}
			break;

		case 'quick reply':
			request_body.message = {
				text: message_payload.payload.text,
				quick_replies: message_payload.payload.quick_replies
			}
			break;
		
		default:
			request_body.message.attachment = {				
				type: type,
				payload: message_payload
			}
	}

	request.post(messenger_api_url, {form: request_body}, (err, res, body) => {
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
      console.error("Failed calling Send API", res.statusCode, res.statusMessage, body.error);
    }
	});
}

function postSenderAction (sender_action, ps_user_id) {
	let timeout = 2500;
	let request_body = {
		'recipient': {
			'id': ps_user_id, 
			'sender_action':sender_action
		}
	}

	if (sender_action === 'mark_seen') {
		timeout = 1000;
	}

	setTimeout(() => {
		request.post(messenger_api_url, {form: request_body}, (err, res, body) => {
			if (err) {
				console.error(err);
			}
		})
	}, timeout);
}

function getUserInfo (ps_user_id, callback) {
	let user_fields = 'first_name, last_name, timezone, is_payment_enabled';
	let uri = `${graph_api_url}/v2.6/${ps_user_id}?field=${user_fields}&access_token=${page_token}`;
	
	request.get(uri, (err, res, body) => {
		callback(body);
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