This fork addresses an issue that causes the script to fail when sending the batches of addresses to blockchain.info. If you are getting an "Unexpected end of JSON", "CORS policy", or "Connectivity issues" error, then give this fork a try. 

Blockchain.info's API documentation states that "|" should delimit a multi-address request, but if they are present, the request will fail with a 400 Bad Request. This script uses "," instead, which does work.

# BIP39 Tool

A tool for recovering 12-word bitcoin recovery phrases when you only have 11 words.

## Usage

If you managed to only write down 11 words of your 12-word recovery phrase, or wrote down one word incorrectly, this tool can find the missing word for you.

Your recovery phrase should NEVER be entered into an online website such as this one--however, if you already can't access your money because you are missing a word from your phrase, perhaps you have nothing to lose and are okay with making an exception just this once. If you do recover your funds, please move them to a new wallet ASAP, and discontinue use of the recovery phrase you've entered here.

To start, check the disclaimer and enter your phrase as you have it written down. The progress window below will update you with what is happening. Sit back and be patient--it can take anywhere from 0 to 10 minutes to find your phrase (possibly much longer on a smartphone or slow computer).

## Credits

This program is based on Ian Coleman's excellent BIP39 tool, found at https://github.com/iancoleman/bip39
