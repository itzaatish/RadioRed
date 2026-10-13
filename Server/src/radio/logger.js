// Objective: Emit lightweight structured lifecycle logs without exposing secrets or signed URLs.
function createRadioLogger(output = console) {
  function write(level, event, fields = {}) {
    const payload = JSON.stringify({ event, ...fields });
    const method = typeof output[level] === "function" ? output[level] : output.log;
    method.call(output, `[radio] ${payload}`);
  }

  return Object.freeze({
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  });
}

module.exports = { createRadioLogger };
