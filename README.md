# PlacesBot - A Bot Built on the Facebook Messenger Platform

The PlacesBot is a simple bot built on the [Facebook Messenger Platform](developers.facebook.com/docs/messenger-platform/). The bot does two things:

1. Retrieves restaurants from the Facebook Places Graph.
2. Incorporates humiliating pictures of my dog.

## Incorporated Features

- Send API
- User Profile API
- Places Graph API
- Quick replies
- Geolocation
- Messenger webview
- Sender actions
- List template
- Generic template
- Built-in Natural Language Processing

## Conversation Flow

The PlacesBot is designed to collect a set of inputs from the conversation, then execute a search for matching results from the Places Graph. The sequence of events looks like this:

1. A new person enters the conversation by tapping the 'Get Started' button on the Messenger welcome screen.
2. Placesbot greets the person, and asks if they are ready to look for a place.
3.The person responds with an affirmative or negative response.
4. If the Messenger Platform's built-in NLP return an affirmative response in the webhook event, PlacesBot sends a location quick reply to ask for the person's location.
5. The person provides their location.
6. PlacesBot acknowledge successful receipt of the location, and sends a quick reply asking for the person's preferred search radius.
7. PlacesBot acknowledges receipt of the radius, and asks the person what type of restaurant they want to search for.
8. PlacesBot retrieves the parsed search term from the Messenger Platform's built-in NLP in the webhook event.
9. PlacesBot executes a search of the PlacesGraph, and returns a list template of results.
10. The person selects an item from the list.
11. PlacesBot responds with a generic template that includes the cover image from the restaurant's Facebook Page, a call button, and a URL button that will display photos from the restaurant's Facebook Page.
12. The person taps the URL button to open the webview and display a gallery of pictures.
13. The website calls the `getContext()` function of the Messenger Extensions SDK.
14. The website requests the images from the `/pictures` endpoint of the PlacesBot API, and passes the `signed_request` returned by `getContext()`.
15. The PlaceBot API decrypts the `signed_request` to verify the request is authentic.
16. The PlacesBot API uses the PSID from the decrypted `signed_request` to look up the place the user selected in cache.
17. PlacesBot retrieves photos for the place from the Places Graph and returns them to the website.
18. The website renders a photo gallery in the webview.
19. The person begins a new search by sending a greeting to PlacesBot.
20. PlacesBot asks if the person wants to search from their last provided location.
21. If the Messenger Platform's built-in NLP returns an affirmative response, PlacesBot retrieves the person's last location from cache. If a negative response is returned, PlacesBot sends a location quick reply to get the person's new location.
22. Lather, rinse, and repeat the search process!
