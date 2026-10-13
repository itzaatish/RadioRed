// Objective: Provide typed radio-domain errors that controllers can map to safe HTTP responses.
class RadioError extends Error {
  constructor(message, { statusCode = 500, code = "RADIO_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

class ValidationError extends RadioError {
  constructor(message) {
    super(message, { statusCode: 400, code: "VALIDATION_ERROR" });
  }
}

class NotFoundError extends RadioError {
  constructor(message) {
    super(message, { statusCode: 404, code: "NOT_FOUND" });
  }
}

class ConflictError extends RadioError {
  constructor(message) {
    super(message, { statusCode: 409, code: "CONFLICT" });
  }
}

class DependencyError extends RadioError {
  constructor(message, cause) {
    super(message, { statusCode: 502, code: "DEPENDENCY_ERROR", cause });
  }
}

module.exports = { RadioError, ValidationError, NotFoundError, ConflictError, DependencyError };
