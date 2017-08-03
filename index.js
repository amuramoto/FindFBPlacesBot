'use strict';

const
	request = require('request'),
	express = require('express'),
	app = express(),
	crypto = require('crypto'),
	bodyParser = require('body-parser'),
	client_token = 'https://graph.facebook.com/v2.6/me/messages',
	messenger_api_url = 'https://graph.facebook.com/v2.6/me/messages?access_token=page_token',
	search_api_url = 'https://graph.facebook.com/v2.10/search?',


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
        if (messagingEvent.message) {
          handleMessage(messagingEvent);
        } else if (messagingEvent.delivery) {
          handleDeliveryConfirmation(messagingEvent);
        } else if (messagingEvent.postback) {
          handlePostback(messagingEvent);
        } else if (messagingEvent.read) {
          handleMessageRead(messagingEvent);
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
	let user_id = messagingEvent.sender.id;
	let message_text = messagingEvent.message.text;

	postSenderAction('mark_seen', user_id);	

}

function postSenderAction (sender_action, user_id) {
	let timeout = 1500;
	let request_body = {
		'recipient': {
			'id': user_id, 
			'sender_action':sender_action
		}
	}

	if (sender_action === 'mark_seen') {
		timeout = 500;
	}

	setTimeout(() => {
		request.post(messenger_api_url, request_body, (err, res, body) => {
			if (err) {
				console.error(err);
			}
		})
	}, timeout);
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