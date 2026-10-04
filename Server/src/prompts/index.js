const radioAnnouncement = require("./radio-announcement");
const songIntro = require("./song-intro");

/**
 * Every server prompt belongs in this directory and must be exported here.
 * A prompt can use {{variableName}} placeholders supplied by its caller.
 */
module.exports = {
  "radio-announcement": radioAnnouncement,
  "song-intro": songIntro,
};
