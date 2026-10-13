// Objective: Define the minimal executable contract shared by radio orchestration engines.
class IEngine {
  async execute() {
    throw new Error(`${this.constructor.name} must implement execute(input).`);
  }
}

module.exports = IEngine;
