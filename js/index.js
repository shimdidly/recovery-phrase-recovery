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

  // Set default phrase, for testing only (remove this)  
  DOM.phrase.val("find express cupboard witness quick able debris town online east soda");

  var possiblePhrases = [];
  var batches = [[]];
  var batch1, batch2;

  var progressLog = "";

  // Most mistakes happen in the middle of the phrase, so we start replacing words in the middle and move out.  
  var testOrder = [6, 7, 5, 8, 4, 9, 3, 10, 2, 11, 1, 12];
  
  var n = {
    test: 0, // which test position we are swapping words for
    word: 0, // which word we're swapping
    phrase: 0, // which phrase we are calculating an address for
    batch: 0, // which batch we are looking up via api
    batchaddr: 0, // how many addresses have been batched through api
    singleaddr: 0, // how many addresses have been individually checked through api
    totalsingleaddr: 0
  }

  /*
   * Status:
   *    0 Stopped
   *    1 Calculating phrases
   *    2 Calculating addresses / Sending batches to API
   *    3 Finished calculating addresses
   *    4 Found a hit, narrowing it down via API
   *    5 Done.
   */

  var status = 0;

  var checkedAddresses = 0;

  // What the user has for their phrase, what language it's in, the word list for that language  
  var existingPhrase, language, words;
  
  var processTimer;

  function init() {
    // Events
    DOM.phrase.on("input", delayedPhraseChanged);
    DOM.start.on("click", startClicked);
    hidePending();
    hideValidationError();
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
    DOM.phrase.val(DOM.phrase.val().toLowerCase());
    // Get the mnemonic phrase
    var errorText = findPhraseErrors(DOM.phrase.val());
    if (errorText) {
      showValidationError(errorText);
      return;
    }
    hidePending();
  }

  function startClicked(event) {
    event.preventDefault();

    if (status == 0) {
      
      var validated = findPhraseErrors(DOM.phrase.val());    
      if (validated != false) {
        showValidationError(validated);
        return;
      }
      
      progressLog = "";
      status = 1;

      DOM.start.text("Stop");
      DOM.phrase.attr("readOnly", true);
      addProgress("Generating possible combinations...");
      addProgress("Progress:");
      
      existingPhrase = phraseToWordArray(DOM.phrase.val());
      language = getLanguage();
      words = WORDLISTS[language];

      startTime();
      runRecovery();

    } else if (status == 5) {
      // reset
      status = 0;
      n = {test: 0, word: 0, phrase: 0,batch: 0, batchaddr: 0, singleaddr: 0}

      DOM.phrase.attr("readOnly", false);
      DOM.start.text("Start");
      progressLog = "";
      DOM.progress.html = "";

    } else {

      // Stop and reset
      status = 0;
      n = {test: 0, word: 0, phrase: 0,batch: 0, batchaddr: 0, singleaddr: 0}

      DOM.phrase.attr("readOnly", false);
      DOM.start.text("Start");
      addProgress("Aborted.");
    }
  }

  // Time-consuming loops can completely lock up the browser, so we use timeouts to break up each loop into segments and give the browser time to do other things in between. 
  // At the end of each segment, call runRecovery with settimeout, and based on the global "status" runrecovery will call the next segment to run.
  
  function runRecovery() {
    switch (status) {
      case 0:
        break;
      case 1:
        generatePhrases();
        break;
      case 2:
        calculateAddresses();
        break;
      case 3:
        break;
      case 4:
        divideAndConquer();
        break;
      case 5:
        break;
    }
  }

// Recovery methods

  function generatePhrases() {
    
    if (n.word >= words.length) {
      n.test++;
      n.word = 0;
    }
    
    if (n.test >= testOrder.length) {
      // All phrases generated
      status = 2;

      updateProgress("Progress: 24576 / 24576 (Took " + parseTime(stopTime()) + ")");

      addProgress("Found " + possiblePhrases.length + " possibilities.");
      addProgress("Checking the blockchain for existing wallets...")
      addProgress("Progress:");
    
      startTime();
      setTimeout(checkAddressBatch, 10000);
      setTimeout(runRecovery, 0);
      return;
    }
    
    var toReplace = testOrder[n.test] - 1;

    for (; n.word < words.length; n.word++) {
      var testPhrase = [];

      // Generate phrase to test...

      if (existingPhrase.length == 11) {
       // If 11 words present
        for (var i = 0; i < 12; i++) {
          if (i < toReplace) {
            testPhrase.push(existingPhrase[i]);
          } else if (i > toReplace) {
            testPhrase.push(existingPhrase[i - 1]);
          } else {
            testPhrase.push(words[n.word]);
          }
        }

      } else {
        // If 12 words present
        for (var i = 0; i < 12; i++) {
          if (i == toReplace) {
            testPhrase.push(words[n.word]);
          } else {
            testPhrase.push(existingPhrase[i]);
          }
        }
      }      

      testPhrase = wordArrayToPhrase(testPhrase, language);

      // Check validity
      var isValid = mnemonic.check(testPhrase);

      if (isValid) {
        // Add possibility
        possiblePhrases.push(testPhrase);
      }

      if (n.word % 100 == 0) {
        var done = (n.word + (n.test * 2048));
        var remaining = 24576 - done;
        updateProgress("Progress: " + done + " / 24576");
        n.word++
        break;
      }
    }
    setTimeout(runRecovery, 0);
  }

  function calculateAddresses() {
    if (n.phrase >= possiblePhrases.length) {
      // Finished calculating addresses. Just waiting on api callbacks.
      status = 3;
      updateProgress("Progress: " + possiblePhrases.length + " / " + possiblePhrases.length + " (Took " + parseTime(stopTime()) + ")");
      addProgress("Reviewing...")
      return;
    }

    calcBip32RootKeyFromSeed(possiblePhrases[n.phrase], "");
    calcBip32ExtendedKey("m/0'/0");

    var key = bip32ExtendedKey.derive(0);

    batches[n.batch].push({ phrase: possiblePhrases[n.phrase], address: key.getAddress().toString()});
          
    updateProgress("Progress: " + n.phrase + " / "+ possiblePhrases.length + " (" + timeLeft(n.phrase, possiblePhrases.length - n.phrase) + " remaining)");
    n.phrase++;
    setTimeout(runRecovery, 0);
  }

  // TODO Checkaddressbatch timeout doesn't stop if on status 3. Should stop. Also, if before last api reply but after last request sent, should say "thinking..." or something. If we find a hit, it shouldn't show up.


  // The API is rate limited, so we ask for the status of multiple keys with one call
  function checkAddressBatch() {
    console.log("Sending batch " + n.batch);

    if (status == 0) return; 
    
    var addressList = "";
    var currBatch = n.batch;
    n.batch++;
    batches[n.batch] = [];

    for (var i = 0; i < batches[currBatch].length; i++) {
      addressList += batches[currBatch][i].address;
      if (i < batches[currBatch].length - 1) addressList += "|";
      n.batchaddr++;
    }
      
    $.get("https://blockchain.info/q/getreceivedbyaddress/" + addressList, function (data) {

      //TODO error handling. Set status to 0 and push error if API problem.

      if (data != 0) {
        status = 4;

        // Get number of divides required, so we can give a visual indicator
        n.totalsingleaddr = calcSplitTimes(batches[currBatch].length);

        splitBatch(batches[currBatch]);
        
        updateProgress("Progress: " + n.phrase + " / " + possiblePhrases.length + " (Took " + parseTime(stopTime()) + ")");
        addProgress("Found something, analyzing...");
        addProgress("Progress:");

        setTimeout(runRecovery, 0);

      } else {
        console.log("Got no hits.");
        if (n.batchaddr >= possiblePhrases.length) {
          fail();
        } else {
          setTimeout(checkAddressBatch, 10000);
        }
      }
    });  
  }

  function divideAndConquer() {

    var addressList = "";    
    for (var i = 0; i < batch1.length; i++) {
      addressList += batch1[i].address;
      if (i < batch1.length - 1) addressList += "|";
    }

    console.log(addressList);    
    $.get("https://blockchain.info/q/getreceivedbyaddress/" + addressList, function (data) {

      updateProgress("Progress: " + n.singleaddr + " / " + n.totalsingleaddr);
      n.singleaddr++;

      if (data != 0) {
        if (batch1.length == 1) {
          console.log(batch1[0].address);
          succeed(batch1[0].phrase);
          return;
        } else {
          console.log("Found in batch one, splitting " + batch1.length + " addresses into two.");
          splitBatch(batch1);
          setTimeout(runRecovery, 5000);
        }
      } else {
        if (batch2.length == 1) {
          console.log(batch2[0].address);
          succeed(batch2[0].phrase);
          return;
        } else {
          console.log("Found in batch two, splitting " + batch2.length + " addresses into two.");
          splitBatch(batch2);
          setTimeout(runRecovery, 5000);
        }
      }        
    });      
  }

  function splitBatch(batch) {
    var oldBatch = batch;
    var cutoff = Math.floor(batch.length / 2);
    batch1 = [];
    batch2 = [];

    for (var i = 0; i < cutoff; i++) {
      batch1.push(batch[i]);
    }

    for (; cutoff < batch.length; cutoff++) {
      batch2.push(batch[cutoff]);
    }
  }

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
    if (words.length < 11 || words.length > 12) return "Must have 11 or 12 words of phrase.";
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

  function wordArrayToPhrase(words, language) {
    var phrase = words.join(" ");
    if (typeof language == "undefined") language = getLanguageFromPhrase(phrase);
    if (language == "japanese") {
      phrase = words.join("\u3000");
    }
    return phrase;
  }

  function addProgress(text) {
    progressLog += text + "<br>";
    DOM.progress.html(progressLog);
  }

  function updateProgress(text) {
    var old =progressLog.substring(0,progressLog.lastIndexOf("<br>", progressLog.length - 5));
    progressLog = old + "<br>" + text + "<br>";
    DOM.progress.html(progressLog);
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

  function calcSplitTimes(items) {
    var splits = 0;
    while (items > 1) {
      items = Math.floor(items / 2);
      splits++;
    }
    return splits;
  }

  function comparePhraseForDisplay(phrase) {
    var wordArray = phraseToWordArray(phrase);
    for (var i = 0; i < wordArray.length; i++) {
      if (wordArray[i] != existingPhrase[i]) {
        wordArray[i] = '<span class="missingWord">' + wordArray[i] + '</span>';
        break;
      }
    }
    return wordArray.join(" ");
  }

  function succeed(phrase) {
    status = 5;
    DOM.start.text("Reset");
    //progressLog = ""; #Uncomment to clear screen before printing success message
    addProgress("====================");
    addProgress("Success!!");
    addProgress("");
    addProgress("Your phrase has been found:  ");
    addProgress('<span class="foundPhrase">' + comparePhraseForDisplay(phrase) + '</span>');
    addProgress("");
    addProgress("====================");
    addProgress("If you found this tool useful, consider sending a donation!");

  }

  function fail() {
    status = 5;
    DOM.start.text("Reset");
    addProgress("====================");
    addProgress("");
    addProgress('<span class="foundPhrase">Unfortunately, no valid phrase was found.</span>');
    addProgress("");
    addProgress("====================");
    addProgress("If you found this tool useful, consider sending a donation!");
  }

  init();

})();
