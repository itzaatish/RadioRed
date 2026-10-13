// Objective: Serialize selected in-process session operations without adding external locking infrastructure.
/** A small in-process lock used to serialize starts for this single-listener service. */
class AsyncKeyLock {
  constructor() {
    this.tails = new Map();
  }

  async run(key, operation) {
    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}

module.exports = { AsyncKeyLock };
