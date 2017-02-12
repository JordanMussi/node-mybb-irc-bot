/******************************************\
**   __  __       ____  ____        _     **
**  |  \/  |_   _| __ )| __ )  ___ | |_   **
**  | |\/| | | | |  _ \|  _ \ / _ \| __|  **
**  | |  | | |_| | |_) | |_) | (_) | |_   **
**  |_|  |_|\__, |____/|____/ \___/ \__|  **
**          |___/                         **
**                                        **
**      Copyright © 2017 MyBB Group       **
\******************************************/

/*
 * MAIN SERVER CONFIGURATION
 */
var config = {
  server: 'irc.freenode.net',
  channels: ['#mybb', '#mybb-staff'], // Auto-join IRC channels, if channel has a key specify it after chanel name (with a space)
  botName: 'MyBBot',
  realName: "A friendly bot that bridges MyBB's IRC and Discord channels.",
  nickservPassword: '',
  floodProtectionDelay: 1000,
  secure: true, // Use a secure conection?
  sasl: true, // Authenticate using SASL?
  username: '', // Username for SASL
  joinOnIdentify: true, // Only join channels once identified (when given cloak)

  /*
   * DISCORD CONFIG
   */
  // Token for your app: https://discordapp.com/developers/applications/me/
  discordToken: '',
  channelMapping: {
    /*
     * Map Discord channels to IRC channels
     *
     * All channel names must be in lower case.
     * Always start Discord channel names with a #
     *
     * Add IRC channel keys after the channel name
     *   e.g. "#discord-chan": "#irc-chan chankey"
     */
    '#irc': '#mybb',
    '#private-staff': '#mybb-staff'
  },
  /*
   * Who to colour nicknames for
   *   roles: Colours nicks of users in roles specified in ircNickColorRoles, key values are the color to use
   *   all: All nicks are coloured using the length of the nick to determine the colour
   */
  ircNickColor: 'roles',
  ircNickColorRoles: {
    // The first role in this object that the user belongs to wins
    'MyBB Team': 'orange'
  },
  ircNickBold: true, // Whether to make the nickname bold in messages sent to IRC
  commandCharacters: ['!', '.'], // Message is treated as a command if it starts with one of these characters
  pastebinDevKey: '',
  pastebinExpiration: '1W',

  welcomePMMemoryStrength: 600000, // Miliseconds until we forget we have already welcomed a user to a particular channel.
  welcomePMChans: {
    '#mybb': ''// "#mybb-random #mybb-20-development #mybb-18-development #mybb-18-extend #mybb-18-support",
  },
};

/*
 * CHANNEL OPTIONS CONFIGURATION
 */
var options = {
  '#mybb': {
    friendlyName: 'MyBB',
    friendlyNameS: 'MyBB\'s',
    facebook: 'https://www.facebook.com/MyBBoard',
    twitter: 'https://twitter.com/MyBB',
    github: 'https://github.com/mybb',
    docs: 'https://docs.mybb.com',
    forums: 'https://community.mybb.com',
    forumsName: 'MyBB Community Forums',
    topicTemplate: 'MyBB: because free never tasted so good! :: DISCORD_TOPIC',
    useColors: true,
  },
  '#mybb-staff': {
  	topicTemplate: false
  }

  /*
   * IMPORTANT INFORMATION!
   *
   * The channel name *must* be in lower case! (e.g. #mybb NOT #MyBB)
   *
   * If the value is not set then the associated command(s) will be disabled
   *  for that channel.
   *
   * Options are inherited from parent channels. If #mybb-test doesn't have
   *  any options specified it is inherited from #mybb. Likewise if it is
   *  missing one option, that is inherited from the parent channel.
   *
   */
};

/*
 * END OF CONFIGURATION
 */

///////////////////////////////////////////////////////////////////////////////
// Actual bot stuff

// Get the lib
var irc = require('irc');
var request = require('request');
var cheerio = require('cheerio');
var google = require('google');
var util = require('util');
var async = require('async');
var discordLib = require('discord.js');
var _ = require('lodash');


_.forOwn(config.channelMapping, (ircChan, discordChan) => {
  config.channelMapping[discordChan] = ircChan.split(' ')[0].toLowerCase();
});

config.channelMappingInv = _.invert(config.channelMapping);

const NICK_COLORS = ['light_blue', 'dark_blue', 'light_red', 'dark_red', 'light_green',
  'dark_green', 'magenta', 'light_magenta', 'orange', 'yellow', 'cyan', 'light_cyan'];

var botOptions = {
  channels: config.channels,
  userName: config.botName,
  realName: config.realName,
  floodProtection: true,
  floodProtectionDelay: config.floodProtectionDelay,
  debug: true,
  showErrors: true,
  retryCount: 10
}

if(config.sasl == true) {
  botOptions.sasl = true;
  botOptions.username = config.username;
  botOptions.password = config.nickservPassword;
}

if(config.joinOnIdentify == true) {
  botOptions.channels = [];
}

if(config.secure == true) {
  botOptions.secure = true;
  if(config.port && config.port != '') {
    botOptions.port = config.port;
  } else {
    botOptions.port = '6697';
  }
}

// Create the bot name
var bot = new irc.Client(config.server, config.botName, botOptions);

var discord = new discordLib.Client({ autoReconnect: true });
discord.login(config.discordToken);

if(config.joinOnIdentify == true) {
  bot.addListener('notice', function(from, to, message) {
    if (from == 'NickServ' && message.indexOf('You are now identified for') == 0) {
      for(var i=0; i<config.channels.length; i++) {
        bot.join(config.channels[i]);
      }
    }
    return;
  });
}

var checkCommands = function(from, to, message) {
  if (message.toLowerCase().indexOf('!user ') == 0 && numParams(message) >= 1 && isEnabled(to, 'forums')) {
    var searchName = getParams(message).join(' ');
    searchUser(bot, to, searchName);
  }
  else if ((message.toLowerCase().indexOf('!docs ') == 0 || message.toLowerCase().indexOf('!wiki ') == 0) && numParams(message) >= 1 && isEnabled(to, 'docs')) {
    var name = getParams(message).join(' ');
    searchDocs(bot, to, name);
  }
  else if (message.toLowerCase().indexOf('!google ') == 0 && numParams(message) >= 1) {
    var term = getParams(message).join(' ');
    searchGoogle(bot, to, term);
  }
  else if (message.toLowerCase().indexOf('!battle ') == 0 && numParams(message) >= 1 && message.toLowerCase().indexOf(' vs. ') >= 0) {
    var input = getParams(message).join(' ');
    var terms = input.split(' vs. ');
    if (terms[0] && terms[1]) {
      battle(bot, to, terms[0], terms[1]);
    }
  }
  else if (message.toLowerCase() == '!github' && isEnabled(to, 'github')) {
    sayGlobal(to, getOption(to, 'friendlyName') + ' GitHub: ' + getOption(to, 'github'));
  }
  else if (message.toLowerCase().indexOf('!github ') == 0 && numParams(message) >= 1 && isEnabled(to, 'github')) {
    var params = getParams(message);
    github(bot, to, params);
  }
  else if (message.toLowerCase() == '!twitter' && isEnabled(to, 'twitter')) {
    sayGlobal(to, getOption(to, 'friendlyName') + ' Twitter: ' + getOption(to, 'twitter'));
  }
  else if (message.toLowerCase() == '!facebook' && isEnabled(to, 'facebook')) {
    sayGlobal(to, getOption(to, 'friendlyName') + ' Facebook: ' + getOption(to, 'facebook'));
  }
  else if (message.toLowerCase() == '!help') {
    sayGlobal(from, 'If you need my help, send me a PM with "help"');
  }
};

// Listen for any channel messages
bot.addListener('message#', function (from, to, message) {
  to = to.toLowerCase();
  util.log(from + ' => ' + to + ': ' + message);

  if (typeof to !== 'undefined' && to != 'undefined') {
    sendToDiscord(from, to, message);
  }

  checkCommands(from, to, message);
});

bot.addListener('selfMessage', function (to, message) {
  checkCommands('', to, message);
});

// Listen for any channel notice
bot.addListener('notice', function (from, to, message) {
  to = to.toLowerCase();
  util.log(from + ' => ' + to + ': ' + message);

  sendToDiscord(from, to, '*' + message + '*');
});

// Listen for any channel action
bot.addListener('action', function (from, to, message) {
  to = to.toLowerCase();
  util.log(from + ' => ' + to + ': ' + message);

  sendToDiscord(from, to, '_' + message + '_');
});

// Listen to PMs
bot.addListener('pm', function (from, message) {
  util.log(from + ' => ME: ' + message);
  if (message.toLowerCase() == 'help') {
    getHelp(bot, from);
  }
  else if (message.toLowerCase() == 'about') {
    bot.say(from, 'I\'m written in Node.js and my author is DennisTT.  My source can be found at https://github.com/DennisTT/node-mybb-irc-bot');
    bot.say(from, 'Feel free to develop me, but please submit a pull request after.');
  }
  else if (message.toLowerCase() == 'hello') {
    bot.say(from, 'Hello to you too!');
  }
  else {
    bot.say(from, 'Sorry, I don\'t understand what you want.  Say "help" if you need help.');
  }
});

var welcomedUsers = {};
for(chan in config.welcomePMChans) {
	welcomedUsers[chan] = {};
}

bot.addListener('join', function (channel, nick) {
  channel = channel.toLowerCase();
  nick = nick.toLowerCase();
  if(nick !== bot.nick.toLowerCase()) {
    util.log(nick + ' joined ' + channel);
    if(typeof config.welcomePMChans[channel] !== 'undefined' && typeof welcomedUsers[channel][nick] === 'undefined') {
      sendWelcomePM(channel, nick);
      welcomedUsers[channel][nick] = setTimeout(function() {
        delete welcomedUsers[channel][nick];
      }, config.welcomePMMemoryStrength);
    }
  }
});

// On connection
bot.addListener('motd', function(message) {
  // Check name
  if (config.nickservPassword != '') {
    util.log('Recovering nickname');
    recoverNick();
  }
});

// Error handler
bot.addListener('error', function(message) {
  util.log('IRC Error: ', message);
});

discord.on('ready', () => {
  util.log('Connected to Discord');
});

discord.on('error', error => {
  util.log('Discord Error: ', error);
});

discord.on('message', message => {
  // Ignore bot messages and people leaving/joining
  sendToIRC(message);
});

discord.on('channelUpdated', function(before, after) {
  channel = discord.channels.get('id', before.id);
  chan = '#' + channel.name;
  if(before.topic !== after.topic && typeof config.channelMapping[chan] !== 'undefined' && isEnabled(config.channelMapping[chan], 'topicTemplate')) {
    bot.send('TOPIC', config.channelMapping[chan], getOption(config.channelMapping[chan], 'topicTemplate').replace('DISCORD_TOPIC', after.topic));
  }
});

// Debug response handler
//bot.addListener('raw', function (message) {
//  console.log('raw: ', message);
//});

///////////////////////////////////////////////////////////////////////////////
// Actions

var recoverNick = function() {
  if (typeof config.username !== 'undefined') {
  	var account = config.username;
  } else {
  	var account = config.botName;
  }
  bot.say('NickServ', 'identify ' + account + ' ' + config.nickservPassword);
  setTimeout(function() {
    bot.say('NickServ', 'ghost ' + config.botName);
  }, 3000);
  setTimeout(function() {
    bot.say('NickServ', 'release ' + config.botName);
  }, 6000);
  setTimeout(function() {
    bot.send('NICK', config.botName);
  }, 9000);
}

var getHelp = function(bot, to) {
  bot.say(to, 'I respond to the following commands on channels:');
  bot.say(to, '!user <username> - displays some info about a user on the channel\'s forums');
  bot.say(to, '!docs [# results] <search term> - searches channel\'s docs for search term, and returns top result (by default) or up to a maximum of 5 if specified');
  bot.say(to, '!google [# results] <search term> - searches Google for search term, and returns top result (by default) or up to a maximum of 5 if specified');
  bot.say(to, '!battle <term1> vs. <term2> - does a Google battle with number of results between term1 and term2');
  bot.say(to, '!facebook - links to the channel\'s Facebook page');
  bot.say(to, '!twitter - links to the channel\'s Twitter account');
  bot.say(to, '!github <repository> <pull|issue> <id> - searches the channel\'s organization for a repository, pull request or issue');
  bot.say(to, 'In addition, I respond to the following commands by PM:');
  bot.say(to, 'help - this text you\'re reading');
  bot.say(to, 'about - about me');
}

var searchUser = function(bot, to, searchName) {
  util.log('Look for user: ' + searchName);

  // Search the member list, hopefully the user will be somewhere within the first 300 results
  request.post(getOption(to, 'forums') + '/memberlist.php', { form: { username: searchName, perpage: 300 } }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      $ = cheerio.load(body);

      var usernamesFound = [];
      var found = false;

      // Look at the list of users we have been given
      $('tr').each(function(i, e) {
        var numCells = $(this).children('td').toArray().length;
        // Only look at rows that have 7 columns and aren't the first 2 (headers)
        if (numCells != 7 || i < 2) {
          return;
        }

        var userRow = $(this);

        var username = userRow.children('td').eq(1).children('a').eq(0).text()
        if(username.trim() != '') {
            usernamesFound.push(username);
        }

        if (username.toLowerCase() == searchName.toLowerCase()) {
          // User matched!
          found = true;

          var profileLink = userRow.children('td').eq(1).children('a').eq(0).attr('href');
          var postCount = userRow.children('td').eq(4).text();
          var regDate = userRow.children('td').eq(2).text().split(',')[0];
          var lastVisitDate = userRow.children('td').eq(3).text().split(',')[0];
          sayGlobal(to, username + ': ' + postCount + ' posts on the ' + getOption(to, 'forumsName') + ', last visited ' + lastVisitDate + ', member since ' + regDate + '. ' + profileLink);
        }

      });

      if (!found) {
        if (usernamesFound.length > 0) {
          sayGlobal(to, 'I couldn\'t find ' + searchName + ', did you mean ' + usernamesFound[Math.floor(Math.random()*usernamesFound.length)] + '?');
        }
        else {
          sayGlobal(to, 'I couldn\'t find ' + searchName);
        }
      }
    }
  });
}

var searchDocs = function(bot, to, term) {

  // Set number of results per page (it might come from the first word of the term)
  google.resultsPerPage = 1;
  var firstTerm = term.split(' ')[0];
  if (isNumber(firstTerm)) {
    google.resultsPerPage = Math.min(parseInt(firstTerm), 5);
    term = term.split(' ').slice(1).join(' ');
  }

  util.log('Search docs for: ' + term + ' and get ' + google.resultsPerPage + ' results');

  google(term + ' site:' + getOption(to, 'docs'), function(err, next, links){
    if (err) {
      util.log(err);
      sayGlobal(to, 'Error fetching search results. Please try again later.');
      return;
    }

    if (links && links.length > 0)
    {
      // We want to show the lesser of what we have, or what we've specified as the limit
      for (var i = 0; i < Math.min(links.length, google.resultsPerPage); ++i) {
        var text = links[i].title;
        if (links[i].link != null) {
          text += ' - ' + links[i].link;
        }
        sayGlobal(to, text);
      }
    }
    else {
      sayGlobal(to, 'No MyBB docs results for search term: ' + term);
    }
  });
};

var searchGoogle = function(bot, to, term) {

  // Set number of results per page (it might come from the first word of the term)
  google.resultsPerPage = 1;
  var firstTerm = term.split(' ')[0];
  if (isNumber(firstTerm)) {
    google.resultsPerPage = Math.min(parseInt(firstTerm), 5);
    term = term.split(' ').slice(1).join(' ');
  }

  util.log('Search Google for: ' + term + ' and get ' + google.resultsPerPage + ' results');

  google(term, function(err, next, links){
    if (err) {
      util.log(err);
      bot.say(to, 'Error fetching search results. Please try again later.');
      return;
    }

    if (links && links.length > 0)
    {
      // We want to show the lesser of what we have, or what we've specified as the limit
      for (var i = 0; i < Math.min(links.length, google.resultsPerPage); ++i) {
        var text = links[i].title;
        if (links[i].link != null) {
          text += ' - ' + links[i].link;
        }
        bot.say(to, text);
      }
    }
    else {
      bot.say(to, 'No Google results for search term: ' + term);
    }
  });
};

var battle = function(bot, to, term1, term2) {
  util.log('Google battle: ' + term1 + ' vs. ' + term2);

  var getNumResults = function (error, response, body, callback) {
    if (!error && response.statusCode == 200) {
      $ = cheerio.load(body);
      var resultsString = $('#resultStats').text();
      if (!resultsString)
      {
        callback(null, 0);
        return;
      }
      var matches = resultsString.match(/ [\d,]+ /);
      console.log(matches[0]);
      var string = matches[0].replace(/,/g, '');
      console.log(string);
      var number = parseInt(matches[0].replace(/,/g, ''));
      console.log(number);
      callback(null, number);
    }
    else {
      callback(error, null);
    }
  };

  async.parallel({
    '1': function (callback) {
      request.get('https://www.google.com/search?q=' + term1, function (error, response, body) {
        getNumResults(error, response, body, callback);
      });
    },
    '2': function (callback) {
      request.get('https://www.google.com/search?q=' + term2, function (error, response, body) {
        getNumResults(error, response, body, callback);
      });
    }
  },
  function (error, results) {
    if (error) {
      util.log('Google battle error: ', error);
      sayGlobal(to, 'Sorry, no referee showed up for this Google battle :(');
    }
    else {
      var winMessage = 'The winner is: ';
      if (results['1'] > results['2']) {
        winMessage += wrapBoldIRC(term1, to);
      }
      else if (results['2'] > results['1']) {
        winMessage += wrapBoldIRC(term2, to);
      }
      else {
        winMessage = 'It was a tie!';
      }

      sayGlobal(to, wrapBoldIRC('GOOGLE BATTLE: ', to) + term1 + ' (' + results['1'] + ') vs. ' + term2 + ' (' + results['2'] + ').  ' + winMessage);
    }
  });
};

var github = function(bot, to, params) {
  var repo = params[0], //repo name
      view = params[1], //pull or issue
      id   = params[2], //pull/issue id
      viewCapital = (view) ? view.charAt(0).toUpperCase() + view.slice(1) : null;

  // go through provided parameters and generate an appropriate answer
  if(repo) {
    if(view) {
      if(view == 'pull' || view == 'issue') {
        if(view == 'issue') view = 'issues';

        if(id && isNumber(id)) { //user is requesting link to pull/issue
          sayGlobal(to, repo + ' ' + viewCapital + ' ' + '#' + id + ': ' + getOption(to, 'github') + '/' + repo + '/' + view + '/' + id);
        }
        else {
          sayGlobal(to, errorMessage);
        }
      }
      else {
        sayGlobal(to, errorMessage)
      }
    }
    else { //user is requesting repo url
      sayGlobal(to, repo + ' repository: ' + getOption(to, 'github') + '/' + repo);
    }
  }
  else {
    sayGlobal(to, errorMessage);
  }
};

var sendWelcomePM = function(channel, nick) {
  bot.say(nick, "Hello traveller! " + getOption(channel, 'friendlyNameS') +" IRC channel has been linked with Discord! Read more here: https://blog.mybb.com/2016/10/13/project-updates-october-2016/");
  bot.say(nick, "I send messages between linked Discord and IRC channels. At the moment you are in " + channel + ".");
  if(typeof config.welcomePMChans !== 'undefined' && typeof config.welcomePMChans[channel] !== 'undefined' && config.welcomePMChans[channel] != '') {
    bot.say(nick, "I send messages between linked Discord and IRC channels. At the moment you are in the " + channel + " lobby.");
    bot.say(nick, "You may join one of these channels to start talking to other users:");
    bot.say(nick, config.welcomePMChans[channel]);
  } else {
    bot.say(nick, "You can start talking to other users on this channel. Conversations on other Discord channels won't be sent to IRC so to get the best experience please consider using the Discord App.");
  }

  bot.say(nick, "Note that IRC allows other users to see your IP address if you are not wearing a cloak. Please consider using the Discord App if this is something that concerns you.");
}

///////////////////////////////////////////////////////////////////////////////
// Helpers

var numParams = function(text) {
  return text.split(' ').length-1;
};

var getParams = function(text) {
  return text.split(' ').slice(1)
}

var isNumber = function(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}

var isEnabled = function(channel, option) {
  channel = channel.toLowerCase();
  if(typeof options[channel] === 'undefined') {
    channel = channel.split('-')[0];
    if(typeof options[channel] === 'undefined') {
      return false;
    }
  } else if(typeof options[channel][option] === 'undefined') {
    channel = channel.split('-')[0];
  }
  if(typeof options[channel][option] === 'undefined' || options[channel][option] == '' || !options[channel][option]) {
    return false;
  }
  return true;
}

var getOption = function(channel, option) {
  channel = channel.toLowerCase();
  if(typeof options[channel] === 'undefined') {
    channel = channel.split('-')[0];
  } else if(typeof options[channel][option] === 'undefined') {
    channel = channel.split('-')[0];
  }
  if(option == 'forumsName' && (typeof options[channel]['forumsName'] === 'undefined' || options[channel]['forumsName'] == '')) {
    return 'forums';
  } else if(option == 'friendlyNameS' && (typeof options[channel]['friendlyNameS'] === 'undefined' || options[channel]['friendlyNameS'] == '') && typeof options[channel]['friendlyName'] !== 'undefined' && options[channel]['friendlyName'] != '') {
    if(options[channel]['friendlyName'].indexOf('s') == options[channel]['friendlyName'].length) {
      return options[channel]['friendlyName'] + "'";
    }
    return options[channel]['friendlyName'] + "'s";
  }

  return options[channel][option];
}

var isCommandMessage = function(message) {
  return config.commandCharacters.indexOf(message[0]) !== -1;
}

var parseText = function(message) {
  const text = message.mentions.reduce((content, mention) => (
    content.replace('<@' + mention.id + '>', '@' + mention.username)
           .replace('<@!' + mention.id + '>', '@' + mention.username)
  ), message.content);

  return text
    .replace(/\n|\r\n|\r/g, ' ')
    .replace(/<#(\d+)>/g, (match, channelId) => {
      const channel = discord.channels.get('id', channelId);
      return '#' + channel.name;
    });
}

var colorNickByRole = function(message) {
  var user = message.author;
  var setColor = '';
  for(var roleName in config.ircNickColorRoles) {
    var role = message.server.roles.get('name', roleName);
    if(user.hasRole(role)) {
      setColor = config.ircNickColorRoles[roleName];
      break;
    }
  }

  if(setColor != '') {
    return irc.colors.wrap(setColor, user.username);
  }
  return user.username;
};

var parseFromDiscord = function(message) {
  message = parseText(message);

  message = message.replace(/```(.*?)```/g, match => {
    const code = match.substring(1);

    /*util.log('Recieved code from Discord. Making paste...')

    var link = '';

    request.post('http://pastebin.com/api/api_post.php', {
      form: {
        api_option: 'paste',
        api_dev_key: config.pastebinDevKey,
        api_paste_private: '1',
        // api_paste_name: '',
        api_paste_expire_date: config.pastebinExpiration,
        // api_paste_format: '',
        api_user_key: '', // Blank for guest
        api_paste_code: code
      }
    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        if(body.indexOf('Bad API request') !== 0) {
          link = body;
          util.log('Paste created: ' + link);
        } else {
          console.log(body);
        }
      }
    });

    if(link != '') {
      return link;
    }*/

    return "<CODE REMOVED>";
  });

  return message;
};
var parseFromIRC = function(message) {
  return message;
};

var sendToDiscord = function(from, to, message) {
  const discordChannelName = config.channelMappingInv[to.toLowerCase()];
  if (discordChannelName) {
    // #channel -> channel before retrieving:
    const discordChannel = discord.channels.get('name', discordChannelName.slice(1));

    if (!discordChannel) {
      util.log('Tried to send a message to a channel the bot isn\'t in: ',
        discordChannelName);
      return;
    }

    const withMentions = message.replace(/@[^\s]+\b/g, match => {
      const user = discord.users.get('username', match.substring(1));
      return user ? user.toString() : match;
    });

    const finalMessage = parseFromIRC(withMentions);

    // Add bold formatting:
    const withAuthor = '**<' + from + '>** ' + finalMessage;
    util.log('DISCORD: ', withAuthor, to, '->', discordChannelName);
    discordChannel.sendMessage(withAuthor);
  }
};

var sendToIRC = function(message) {
  const author = message.author;
  // Ignore messages sent by the bot itself:
  if (author.id === discord.user.id) return;

  const channelName = '#' + message.channel.name;
  const ircChannel = config.channelMapping[channelName];

  util.log('Channel Mapping', channelName, config.channelMapping[channelName]);
  if (ircChannel) {
    const username = author.username;
    var text = parseFromDiscord(message);
    var displayUsername = username;
    if (config.ircNickColor == 'all') {
      const colorIndex = (username.charCodeAt(0) + username.length) % NICK_COLORS.length;
      displayUsername = irc.colors.wrap(NICK_COLORS[colorIndex], username);
    }
    else if (config.ircNickColor == 'roles') {
      displayUsername = colorNickByRole(message);
    }
    if(config.ircNickBold) {
      displayUsername = wrapBoldIRC(displayUsername);
    }

    if (isCommandMessage(text)) {
      const prelude = displayUsername + ' sent a command from Discord';
      sayIRC(ircChannel, prelude);
      sayIRC(ircChannel, text);
    } else {
      if (text !== '') {
        text = '<' + displayUsername + '> ' + text;
        util.log('Sending message to IRC', ircChannel);
        sayIRC(ircChannel, text);
      }

      if (message.attachments && message.attachments.length) {
        message.attachments.forEach(a => {
          const urlMessage = '<' + displayUsername + '> ' + a.url;
          util.log('Sending attachment URL to IRC', ircChannel, urlMessage);
          sayIRC(ircChannel, urlMessage);
        });
      }
    }
  }
};

var sayIRC = function(to, message) {
  message = message.trim()
  if (message.length > 510) {
    message = message.substring(0, 507) + '...';
  }
  bot.say(to, message);
}

/*
var sendGlobalViaDiscord = function(to, message) {
  discord.sendMessage(to, message);
  bot.say(config.channelMapping[to], message);
};*/

var sayGlobal = function(to, message) {
  to = to.toLowerCase();

  bot.say(to, message);

  message = message.replace(/\(.*?)\/g, match => {
    return '**' + match.substring(1) + '**';
  });

  discordChannel = discord.channels.get('name', config.channelMappingInv[to].slice(1))
  discordChannel.sendMessage(message);
};

var wrapBoldIRC = function(text, to) {
  if(typeof to !== 'undefined' && to != '') {
    if(getOption(to, 'useColors')) {
      return '' + text + '';
    }
    return text;
  } else {
    return '' + text + '';
  }
}

///////////////////////////////////////////////////////////////////////////////
// Reusable bits of text

var errorMessage = 'Incorrect and/or missing parameters. Type !help for help.';
