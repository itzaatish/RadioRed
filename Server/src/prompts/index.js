// Objective: Export reusable AI prompt templates and their safe variable renderer.
const radioAnnouncement = require("./radio-announcement");
const songIntro = require("./song-intro");

/**
 * Optional shared prompt library. Server files may import these or define
 * their own instructions before calling src/ai.
 */
module.exports = {
  "radio-announcement": radioAnnouncement,
  "song-intro": songIntro,
};
