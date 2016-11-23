(function() {

  // mnemonics is populated as required by getLanguage
  var mnemonics = { "english": new Mnemonic("english") };
  var mnemonic = mnemonics["english"];
  var seed = null;
  var bip32RootKey = null;
  var bip32ExtendedKey = null;
  var network = bitcoin.networks.bitcoin;

  var phraseChangeTimeoutEvent = null;

  var DOM = {};
  DOM.phrase = $(".phrase");
  DOM.start = $(".start");
  DOM.feedback = $(".feedback");
  DOM.languages = $(".languages a");
  DOM.progress = $(".progress");

  DOM.phrase.val("find express cupboard witness quick able debris town online east soda");

  var possiblePhrases = [];
  var possiblerPhrases = [];

  var progressLog = "";

  var testOrder = [6,7,5,8,4,9,3,10,2,11,1,12];
  var testNo = 0;
  var wordNo = 0;
  var phraseNo = 0;
  var lookupNo = 0;

  var working = 0;
  var checkedAddresses = 0;

  var existingPhrase, language, words;

  var processTimer;

  function init() {
    // Events
    DOM.phrase.on("input", delayedPhraseChanged);
    DOM.start.on("click", startClicked);
    hidePending();
    hideValidationError();
    //populateNetworkSelect();
  }

  // Event handlers

  function delayedPhraseChanged() {
    hideValidationError();
    showPending();
    if (phraseChangeTimeoutEvent != null) {
      clearTimeout(phraseChangeTimeoutEvent);
    }
    phraseChangeTimeoutEvent = setTimeout(phraseChanged, 400);
  }

  function phraseChanged() {
    showPending();
    hideValidationError();
    setMnemonicLanguage();
    // Get the mnemonic phrase
    var phrase = DOM.phrase.val();
    var errorText = findPhraseErrors(phrase);
    if (errorText) {
      showValidationError(errorText);
      return;
    }
    hidePending();
  }

  function startClicked(event) {
    event.preventDefault();
    
    if (working == 0) {
      progressLog = "";
      working = 1;
      
      DOM.start.text("Stop");
      DOM.phrase.attr("readOnly", true);
      addProgress("Generating possible combinations...");
      addProgress("Progress:");

      existingPhrase = phraseToWordArray(DOM.phrase.val());
      language = getLanguage();
      words = WORDLISTS[language];

      startTime();
      findAllPossiblePhrases();
    } else if (working == 1) {
      working = 0;
      testNo = 0;
      wordNo = 0;
      phraseNo = 0;

      DOM.phrase.attr("readOnly", false);
      DOM.start.text("Start");
      addProgress("Aborted.");
    }
  }

// Recovery methods

  function findAllPossiblePhrases() {
    // For each position...
    for (; testNo < testOrder.length; testNo++) {
      var toReplace = testOrder[testNo] - 1;
      // Swap in each word in the list....
      for (; wordNo < words.length; wordNo++) {
        var testPhrase = [];

        // Generate phrase to test...
        for (var i = 0; i < 12; i++) {
          if (i < toReplace) {
            testPhrase.push(existingPhrase[i]);
          } else if (i > toReplace) {
            testPhrase.push(existingPhrase[i-1]);
          } else {
            testPhrase.push(words[wordNo]);
          }   
        }

        testPhrase = wordArrayToPhrase(testPhrase, language);

        // Check validity
        var isValid = mnemonic.check(testPhrase);

        if (isValid) {
          // Add possibility
          possiblePhrases.push({phrase: testPhrase});
        }

        if (wordNo % 100 == 0) {
          if (working == 1) {
            var done = (wordNo + (testNo * 2048));
            var remaining = 24576 - done;
            updateProgress("Progress: " + done + " / 24576");
            setTimeout(findAllPossiblePhrases, 1);
            wordNo++;
            return;
          } else {
            return;
          }
          
        }
      }
      wordNo = 0;
    }

    updateProgress("Progress: 24576 / 24576 (Took " + parseTime(stopTime()) + ")");

    addProgress("Found " + possiblePhrases.length + " possibilities to check.");
    addProgress("Checking the blockchain for existing wallets...")
    addProgress("Progress:");
    
    startTime();
    setTimeout(checkAddressBatch, 10000);
    calculateAddresses();
  };

  function calculateAddresses() {
    if (phraseNo < possiblePhrases.length) {
      calcBip32RootKeyFromSeed(possiblePhrases[phraseNo].phrase, "");
      calcBip32ExtendedKey("m/0'/0");

      var key = bip32ExtendedKey.derive(0);
      possiblePhrases[phraseNo].address = key.getAddress().toString();
      possiblePhrases[phraseNo].lookupNo = lookupNo;
        
      //checkAddressStatus(key.getAddress().toString(), phraseNo);
      
      if (working == 1) {  
        updateProgress("Progress: " + phraseNo + " / "+ possiblePhrases.length + " (" + timeLeft(phraseNo, possiblePhrases.length - phraseNo) + " remaining)");
        phraseNo++;
        setTimeout(calculateAddresses, 1);
      }
    } else {
      updateProgress("Progress: " + possiblePhrases.length + " / " + possiblePhrases.length + " (Took " + parseTime(stopTime()) + ")");
    }  
  }

  function checkAddressBatch() {
    console.log("Sending batch " + lookupNo);

    if (working == 0) return;    
    var addressList = "";
    var currLookup = lookupNo;
    lookupNo++;
    groupTotal = 0;
    
    for (var i = 0; i < possiblePhrases.length; i++) {
      if (possiblePhrases[i].lookupNo == currLookup) {
        addressList += possiblePhrases[i].address + "|";
        checkedAddresses++;
      }
    }
    addressList = addressList.substring(0, addressList.length - 1);
      
    $.get("https://blockchain.info/q/getreceivedbyaddress/" + addressList, function (data) {
      if (data != 0) {
        working = 0;
        lookupNo = currLookup;

        updateProgress("Progress: " + phraseNo + " / " + possiblePhrases.length + " (Took " + parseTime(stopTime()) + ")");
        addProgress("Found something, analyzing...");
        addProgress("Progress:");


        for (var i = 0; i < possiblePhrases.length; i++) {
          if (possiblePhrases[i].lookupNo == lookupNo) {
            possiblerPhrases.push(possiblePhrases[i]);
          }
        }

        lookupNo = 0;
        checkIndividualAddresses();
      } else {
        console.log("Got no hits.");
        if (checkedAddresses >= possiblePhrases.length) {
          fail(); 
        };
        setTimeout(checkAddressBatch, 10000);
      }
    });  
    
  }

  function checkIndividualAddresses() {

    //TODO ---- Split into groups of two, checking the aggregate of each group. repeat to figure out which address it is
    // Count the number of splits there will be, beforehand so we can give an indicator.

    if (lookupNo < possiblerPhrases.length) {
      var which = lookupNo;
      $.get("https://api.blockcypher.com/v1/btc/main/addrs/" + possiblerPhrases[which].address + "/balance", function (data) {

          updateProgress("Progress: " + which + " / " + possiblerPhrases.length);
          if (data.total_received > 0) {
            succeed(possiblerPhrases[which].phrase);
          } else {
            setTimeout(checkIndividualAddresses, 333);
          }
      });
      lookupNo++;
    } else {
      fail();
    }

  }
    
    // https://api.blockcypher.com/v1/btc/main/addrs/1DEP8i3QJCsomS4BSMY2RpU1upv62aGvhD/balance

  // function checkAddressStatus(address, which) {

  //   if (apiTimer - new Date() > 10000) {

  //     var addressList = lookupQueue[0];
  //     for (var i = 0; i < lookupQueue.length; i++) {
  //       addressList+=
  //     }

  //     $.get("https://blockchain.info/q/getreceivedbyaddress/" + address, function (data) {
  //     if (data != 0) {
  //       working = 0;
  //       succeed(which);
  //     } else {
  //       if (checkedAddresses >= possiblePhrases.length) {
  //         console.log(checkedAddresses + "  " + possiblePhrases.length);
  //         fail(); 
  //       };
  //     }
  //     checkedAddresses++;
  //   });
  //   }    
    
  // }

  function calcBip32RootKeyFromSeed(phrase, passphrase) {
    seed = mnemonic.toSeed(phrase, passphrase);
    bip32RootKey = bitcoin.HDNode.fromSeedHex(seed, network);
  }

  function calcBip32ExtendedKey(path) {
    bip32ExtendedKey = bip32RootKey;
    // Derive the key from the path
    var pathBits = path.split("/");
    for (var i=0; i<pathBits.length; i++) {
      var bit = pathBits[i];
      var index = parseInt(bit);
      if (isNaN(index)) {
        continue;
      }
      var hardened = bit[bit.length-1] == "'";
      if (hardened) {
        bip32ExtendedKey = bip32ExtendedKey.deriveHardened(index);
      }
      else {
        bip32ExtendedKey = bip32ExtendedKey.derive(index);
      }
    }
  }

  function showValidationError(errorText) {
    DOM.feedback
      .text(errorText)
      .show();
  }

  function hideValidationError() {
    DOM.feedback
      .text("")
      .hide();
  }

  function findPhraseErrors(phrase) {
    // Preprocess the words
    phrase = mnemonic.normalizeString(phrase);
    var words = phraseToWordArray(phrase);
    if (words.length != 11) return "Must have 11 words of phrase.";
    // Check each word
    for (var i=0; i<words.length; i++) {
      var word = words[i];
      var language = getLanguage();
      if (WORDLISTS[language].indexOf(word) == -1) {
        console.log("Finding closest match to " + word);
        var nearestWord = findNearestWord(word);
        return word + " not in wordlist, did you mean " + nearestWord + "?";
      }
    }
    return false;
  }

  function parseIntNoNaN(val, defaultVal) {
    var v = parseInt(val);
    if (isNaN(v)) {
      return defaultVal;
    }
    return v;
  }

  function showPending() {
    DOM.feedback
      .text("Calculating...")
      .show();
  }

  function hidePending() {
    DOM.feedback
      .text("")
      .hide();
  }

  function findNearestWord(word) {
    var language = getLanguage();
    var words = WORDLISTS[language];
    var minDistance = 99;
    var closestWord = words[0];
    for (var i=0; i<words.length; i++) {
      var comparedTo = words[i];
      var distance = Levenshtein.get(word, comparedTo);
      if (distance < minDistance) {
        closestWord = comparedTo;
        minDistance = distance;
      }
    }
    return closestWord;
  }

  function getLanguage() {
    var defaultLanguage = "english";
    // Try to get from existing phrase
    var language = getLanguageFromPhrase();
    // Default to English if no other option
    return language.length == 0 ? defaultLanguage : language;
  }

  function getLanguageFromPhrase(phrase) {
    // Check if how many words from existing phrase match a language.
    var language = "";
    if (!phrase) {
      phrase = DOM.phrase.val();
    }
    if (phrase.length > 0) {
      var words = phraseToWordArray(phrase);
      var languageMatches = {};
      for (l in WORDLISTS) {
        // Track how many words match in this language
        languageMatches[l] = 0;
        for (var i=0; i<words.length; i++) {
          var wordInLanguage = WORDLISTS[l].indexOf(words[i]) > -1;
          if (wordInLanguage) {
            languageMatches[l]++;
          }
        }
        // Find languages with most word matches.
        // This is made difficult due to commonalities between Chinese
        // simplified vs traditional.
        var mostMatches = 0;
        var mostMatchedLanguages = [];
        for (var l in languageMatches) {
          var numMatches = languageMatches[l];
          if (numMatches > mostMatches) {
            mostMatches = numMatches;
            mostMatchedLanguages = [l];
          }
          else if (numMatches == mostMatches) {
            mostMatchedLanguages.push(l);
          }
        }
      }
      if (mostMatchedLanguages.length > 0) {
        // Use first language and warn if multiple detected
        language = mostMatchedLanguages[0];
        if (mostMatchedLanguages.length > 1) {
          console.warn("Multiple possible languages");
          console.warn(mostMatchedLanguages);
        }
      }
    }
    return language;
  }

  function setMnemonicLanguage() {
    var language = getLanguage();
    // Load the bip39 mnemonic generator for this language if required
    if (!(language in mnemonics)) {
      mnemonics[language] = new Mnemonic(language);
    }
    mnemonic = mnemonics[language];
  }

  // TODO look at jsbip39 - mnemonic.splitWords
  function phraseToWordArray(phrase) {
    var words = phrase.split(/\s/g);
    var noBlanks = [];
    for (var i=0; i<words.length; i++) {
      var word = words[i];
      if (word.length > 0) {
        noBlanks.push(word);
      }
    }
    return noBlanks;
  }

  // TODO look at jsbip39 - mnemonic.joinWords
  function wordArrayToPhrase(words, language) {
    var phrase = words.join(" ");
    if (typeof language == "undefined") language = getLanguageFromPhrase(phrase);
    if (language == "japanese") {
      phrase = words.join("\u3000");
    }
    return phrase;
  }

  function addProgress(text) {
    progressLog += text + "\n";
    DOM.progress.text(progressLog);
  }

  function updateProgress(text) {
    var old =progressLog.substring(0,progressLog.lastIndexOf("\n", progressLog.length - 3));
    progressLog = old + "\n" + text + "\n";
    DOM.progress.text(progressLog);
  }

  function timeLeft(done, remain) {
    var soFar = Math.round(new Date() / 1000) - processTimer;
    
    var left = Math.round((soFar / done) * remain);
    return parseTime(left);    
  }

  function parseTime(total) {
    var min = Math.floor(total / 60);
    var sec = total - (min * 60); 
    if (min > 0) {
      return min + " minutes";
    } else {
      return sec + " seconds";
    }
  }

  function startTime() {
    processTimer = Math.round(new Date() / 1000);
  }

  function stopTime() {
    return Math.round((new Date() / 1000)) - processTimer;
  }

  function succeed(phrase) {
    working = 2;
    progressLog = "";
    addProgress("====================");
    addProgress("Success!!");
    addProgress("");
    addProgress("Your phrase has been found:  ");
    addProgress(phrase);
    addProgress("");
    addProgress("====================");
    addProgress("Refresh page if you want to start a new search.");
    addProgress("If you found this tool useful, consider sending a donation!");

  }

  function fail() {
    working = 2;
    addProgress("====================");
    addProgress("********************");
    addProgress("");
    addProgress("Unfortunately, no valid phrase was found.");
    addProgress("");
    addProgress("********************");
    addProgress("====================");
    addProgress("Refresh page if you want to start a new search.");
    addProgress("If you found this tool useful, consider sending a donation!");
  }

  init();

})();
