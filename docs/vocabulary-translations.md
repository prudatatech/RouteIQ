# Vocabulary translations (driver app and customer app)

One word per thing, in every language. The English words come from the Vocabulary section of `docs/workflow-blueprint.html`. Use the word in this table when you add a string. Do not use a second word for the same idea, even if it reads well.

This covers user-visible text only. Locale keys, API paths, enum values and notification type names keep their old names.

## English

| Idea | Say | Do not say |
| --- | --- | --- |
| Goods we move | shipment (vendor goods: load) | consignment, manifest, cargo manifest |
| Vehicle's journey | trip | route (only for the road path or navigation) |
| Something went wrong | problem | exception, incident, issue, case |
| Spare truck space | return trip | backhaul, capacity window, pool |
| Truck to truck or hub | transfer (driver: hand over goods, receive goods) | transshipment, handover |
| Person receiving | receiver | consignee |

Keep "route" for: Route map, Open full route in Google Maps, and Navigate.

## Per language

| Idea | Hindi | Marathi | Telugu | Kannada | Bengali |
| --- | --- | --- | --- | --- | --- |
| shipment | शिपमेंट | शिपमेंट | షిప్‌మెంట్ | ಶಿಪ್‌ಮೆಂಟ್ | শিপমেন্ট |
| goods | माल | माल | సరుకు | ಸರಕು | মাল |
| load (on the truck) | लोड | लोड | లోడ్ | ಲೋಡ್ | লোড |
| trip | ट्रिप (masculine) | ट्रिप (feminine) | ట్రిప్ | ಟ್ರಿಪ್ | ট্রিপ |
| return trip | वापसी ट्रिप | परतीची ट्रिप | తిరుగు ట్రిప్ | ಹಿಂತಿರುಗುವ ಟ್ರಿಪ್ | ফিরতি ট্রিপ |
| route (road path, map) | रूट | मार्ग | రూట్ | ಮಾರ್ಗ | রুট |
| problem | समस्या | समस्या | సమస్య | ಸಮಸ್ಯೆ | সমস্যা |
| transfer, hand over | सौंपना / सौंपें | सोपवणे / सोपवा | అప్పగింత / అప్పగించండి | ಹಸ್ತಾಂತರ | হস্তান্তর |
| pieces | नग | नग | పీసులు | ಪೀಸ್ / ಪೀಸ್‌ಗಳು | পিস |
| hub | हब | हब | హబ్ | ಹಬ್ | হাব |
| lot | लॉट | लॉट | లాట్ | ಲಾಟ್ | লট |
| receiver | प्राप्तकर्ता | प्राप्तकर्ता | గ్రహీత | ಸ್ವೀಕರಿಸುವವರು | প্রাপক |
| stop | स्टॉप | थांबा | స్టాప్ | ನಿಲ್ದಾಣ | স্টপ |
| booking (customer app) | बुकिंग | बुकिंग | బుకింగ్ | ಬುಕಿಂಗ್ | বুকিং |
| claim | क्लेम | क्लेम | క్లెయిమ్ | ಕ್ಲೇಮ್ | ক্লেম |
| delivery code | डिलीवरी कोड | डिलिव्हरी कोड | డెలివరీ కోడ్ | ಡೆಲಿವರಿ ಕೋಡ್ | ডেলিভারি কোড |

## Notes

- **Trip in every language is "trip" written in the local script.** It is the word drivers already say. Do not use फेरी, यात्रा, ప్రయాణం, ಪ್ರಯಾಣ or যাত্রা for a trip. Those stay only where they mean a journey in general (for example "journey progress").
- **Gender.** In Hindi write ट्रिप as masculine ("ट्रिप पूरा हुआ"). In Marathi write ट्रिप as feminine ("ट्रिप पूर्ण झाली", "ही ट्रिप").
- **Shipments in Hindi.** Write शिपमेंट as masculine ("आपका शिपमेंट"). Do not use कंसाइनमेंट or खेप.
- **Pieces.** Hindi and Marathi use नग on both apps. Telugu, Kannada and Bengali use the freight word that drivers say (పీసులు, ಪೀಸ್, পিস), and the customer app uses the same word. Do not use "package" words (ప్యాకేజీ, ಪ್ಯಾಕೇಜ್, প্যাকেজ) for pieces. The one exception is the hint that explains what a piece is ("cartons, bags or packages").
- **Hub.** हब, హబ్, ಹಬ್ and হাব are the words used in Indian freight, and they are already the same on both apps. They are kept on purpose.
- **Return trip bidding.** Say that the return trip is "open for bids" or "closed for bids". Do not say "capacity window" or "bidding window".
- **Placeholders** such as `{consignee}` are part of the code and stay as they are. Only the words around them change.
